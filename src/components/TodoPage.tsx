import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ListChecks,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Undo2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { db, putRecordAndQueue } from "../db";
import { syncFields } from "../lib/identity";
import { showToast } from "../lib/toast";
import type { TodoItem } from "../types";
import { Modal } from "./Modal";

interface TodoPageProps {
  ownerId: string;
  /** Opens the editor only for this component instance. Kept for simple in-app entry points. */
  openCreateOnMount?: boolean;
  /** A one-shot token used by warm deep links, such as a widget add button. */
  openCreateRequest?: string | null;
  onOpenCreateConsumed?: () => void;
}

interface UndoCompletion {
  todoId: string;
  title: string;
}

const TODO_COLORS = ["#ccecf7", "#d6f2df", "#fff0aa", "#eadffc", "#ffddd8", "#dfe8ff"] as const;
const DEFAULT_TODO_COLOR = TODO_COLORS[0];
const SORT_ORDER_STEP = 100;
const UNDO_DURATION_MS = 3200;

export function TodoPage({
  ownerId,
  openCreateOnMount = false,
  openCreateRequest,
  onOpenCreateConsumed
}: TodoPageProps) {
  const todos = useLiveQuery(
    () => db.todos.where("user_id").equals(ownerId).filter((item) => !item.deleted_at).toArray(),
    [ownerId],
    []
  );
  const [query, setQuery] = useState("");
  const [incompleteOpen, setIncompleteOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [todoToEdit, setTodoToEdit] = useState<TodoItem | null | undefined>(openCreateOnMount ? null : undefined);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undoCompletion, setUndoCompletion] = useState<UndoCompletion | null>(null);
  const previousOwnerIdRef = useRef(ownerId);
  const consumedCreateRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!openCreateRequest || consumedCreateRequestRef.current === openCreateRequest) return;
    consumedCreateRequestRef.current = openCreateRequest;
    setOpenMenuId(null);
    setTodoToEdit(null);
    onOpenCreateConsumed?.();
  }, [onOpenCreateConsumed, openCreateRequest]);

  useEffect(() => {
    if (previousOwnerIdRef.current === ownerId) return;
    previousOwnerIdRef.current = ownerId;
    consumedCreateRequestRef.current = null;
    setQuery("");
    setIncompleteOpen(true);
    setCompletedOpen(false);
    setTodoToEdit(undefined);
    setOpenMenuId(null);
    setBusyId(null);
    setUndoCompletion(null);
  }, [ownerId]);

  useEffect(() => {
    if (!undoCompletion) return;
    const timer = window.setTimeout(() => setUndoCompletion(null), UNDO_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [undoCompletion]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matchingTodos = useMemo(() => todos.filter((todo) => (
    !normalizedQuery || todo.title.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
  )), [normalizedQuery, todos]);
  const incompleteTodos = useMemo(
    () => matchingTodos.filter((todo) => !todo.completed_at).sort(compareTodos),
    [matchingTodos]
  );
  const completedTodos = useMemo(
    () => matchingTodos.filter((todo) => Boolean(todo.completed_at)).sort(compareCompletedTodos),
    [matchingTodos]
  );
  const incompleteCount = todos.filter((todo) => !todo.completed_at).length;
  const activeEditor = todoToEdit === null
    ? null
    : todoToEdit?.user_id === ownerId
      ? todoToEdit
      : undefined;

  function updateQuery(value: string) {
    setQuery(value);
    if (value.trim()) {
      setIncompleteOpen(true);
      setCompletedOpen(true);
    }
  }

  function openEditor(todo?: TodoItem) {
    setOpenMenuId(null);
    setTodoToEdit(todo ?? null);
  }

  async function runTodoAction(todo: TodoItem, action: () => Promise<void>, fallback: string) {
    if (busyId) return;
    setBusyId(todo.id);
    try {
      await action();
    } catch (error) {
      showToast(errorMessage(error, fallback), "error", 6000);
    } finally {
      setBusyId((current) => current === todo.id ? null : current);
    }
  }

  async function toggleCompleted(todo: TodoItem) {
    await runTodoAction(todo, async () => {
      const completing = !todo.completed_at;
      const updated: TodoItem = {
        ...todo,
        ...syncFields(todo),
        completed_at: completing ? new Date().toISOString() : null
      };
      await putRecordAndQueue("todos", updated);
      setOpenMenuId(null);
      if (completing) {
        setUndoCompletion({ todoId: todo.id, title: todo.title });
      } else {
        setUndoCompletion((current) => current?.todoId === todo.id ? null : current);
        showToast("已恢复为未完成待办。", "success");
      }
    }, "更新待办状态失败，请稍后重试。");
  }

  async function undoLastCompletion() {
    const target = undoCompletion;
    if (!target) return;
    setUndoCompletion(null);
    const todo = await db.todos.get(target.todoId);
    if (!todo || todo.user_id !== ownerId || todo.deleted_at || !todo.completed_at) return;
    await runTodoAction(todo, async () => {
      await putRecordAndQueue("todos", { ...todo, ...syncFields(todo), completed_at: null });
      showToast("已撤销完成。", "success");
    }, "撤销失败，请稍后重试。");
  }

  async function togglePinned(todo: TodoItem) {
    setOpenMenuId(null);
    await runTodoAction(todo, async () => {
      await putRecordAndQueue("todos", { ...todo, ...syncFields(todo), is_pinned: !todo.is_pinned });
      showToast(todo.is_pinned ? "已取消置顶。" : "已置顶。", "success");
    }, "更新置顶状态失败，请稍后重试。");
  }

  async function copyTodo(todo: TodoItem) {
    setOpenMenuId(null);
    await runTodoAction(todo, async () => {
      const copy: TodoItem = {
        ...syncFields(undefined, ownerId),
        title: `${todo.title}（副本）`.slice(0, 120),
        color: normalizeTodoColor(todo.color),
        is_pinned: false,
        sort_order: nextSortOrder(todos),
        completed_at: null
      };
      await putRecordAndQueue("todos", copy);
      setIncompleteOpen(true);
      showToast("待办副本已创建。", "success");
    }, "复制待办失败，请稍后重试。");
  }

  async function deleteTodo(todo: TodoItem) {
    setOpenMenuId(null);
    if (!window.confirm(`删除待办“${todo.title}”？删除后会从你的设备和云端移除。`)) return;
    await runTodoAction(todo, async () => {
      const deleted: TodoItem = {
        ...todo,
        ...syncFields(todo),
        deleted_at: new Date().toISOString()
      };
      await putRecordAndQueue("todos", deleted, "delete");
      setUndoCompletion((current) => current?.todoId === todo.id ? null : current);
      showToast("待办已删除。", "success");
    }, "删除待办失败，请稍后重试。");
  }

  async function moveTodo(todo: TodoItem, direction: -1 | 1) {
    setOpenMenuId(null);
    if (normalizedQuery) return;
    const section = (todo.completed_at ? completedTodos : incompleteTodos)
      .filter((item) => item.is_pinned === todo.is_pinned);
    const index = section.findIndex((item) => item.id === todo.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= section.length) return;
    const reordered = [...section];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    await runTodoAction(todo, async () => {
      for (let orderIndex = 0; orderIndex < reordered.length; orderIndex += 1) {
        const item = reordered[orderIndex];
        const sortOrder = (orderIndex + 1) * SORT_ORDER_STEP;
        if (item.sort_order === sortOrder) continue;
        await putRecordAndQueue("todos", { ...item, ...syncFields(item), sort_order: sortOrder });
      }
      showToast(direction < 0 ? "待办已上移。" : "待办已下移。", "success");
    }, "调整待办顺序失败，请稍后重试。");
  }

  const hasMatchingTodos = incompleteTodos.length > 0 || completedTodos.length > 0;

  return (
    <section className="todo-page">
      <header className="page-heading todo-heading">
        <div className="todo-heading-copy">
          <span className="todo-heading-icon" aria-hidden="true"><Check size={22} /></span>
          <div>
            <h1>待办</h1>
            <p>还有 <strong>{incompleteCount}</strong> 项未完成，先从眼前的一件开始。</p>
          </div>
        </div>
        <button type="button" className="button primary compact todo-heading-add" onClick={() => openEditor()}>
          <Plus size={17} />新增待办
        </button>
      </header>

      <div className="todo-toolbar">
        <label className="todo-search">
          <span className="todo-visually-hidden">搜索待办</span>
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索待办"
            onChange={(event) => updateQuery(event.target.value)}
          />
        </label>
        {query && <button type="button" className="todo-clear-search" onClick={() => updateQuery("")}>清空</button>}
      </div>

      {hasMatchingTodos ? (
        <div className="todo-sections">
          <TodoSection
            title="未完成"
            count={incompleteTodos.length}
            open={incompleteOpen}
            onToggle={() => setIncompleteOpen((current) => !current)}
          >
            {incompleteTodos.length ? (
              <TodoList
                todos={incompleteTodos}
                allowManualMove={!normalizedQuery}
                busyId={busyId}
                openMenuId={openMenuId}
                onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)}
                onEdit={openEditor}
                onToggleCompleted={toggleCompleted}
                onTogglePinned={togglePinned}
                onCopy={copyTodo}
                onDelete={deleteTodo}
                onMove={moveTodo}
              />
            ) : incompleteCount === 0 && completedTodos.length > 0 && !query ? (
              <div className="todo-cleared-state">
                <CheckCircle2 size={22} />
                <span><strong>待办已清空</strong><small>已完成的事项会继续保留在下方。</small></span>
              </div>
            ) : <p className="todo-section-empty">没有匹配的未完成待办。</p>}
          </TodoSection>

          <TodoSection
            title="已完成"
            count={completedTodos.length}
            open={completedOpen}
            onToggle={() => setCompletedOpen((current) => !current)}
          >
            {completedTodos.length ? (
              <TodoList
                todos={completedTodos}
                allowManualMove={false}
                busyId={busyId}
                openMenuId={openMenuId}
                onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)}
                onEdit={openEditor}
                onToggleCompleted={toggleCompleted}
                onTogglePinned={togglePinned}
                onCopy={copyTodo}
                onDelete={deleteTodo}
                onMove={moveTodo}
              />
            ) : <p className="todo-section-empty">完成的待办会收在这里。</p>}
          </TodoSection>
        </div>
      ) : (
        <div className="empty-state compact-empty todo-empty-state">
          <ListChecks size={36} />
          <h2>{query ? "没有匹配的待办" : "还没有待办"}</h2>
          <p>{query ? "换个关键词，或清空搜索查看全部待办。" : "把要做的事记下来，完成一项就轻轻勾掉它。"}</p>
          {query ? (
            <button type="button" className="button secondary compact" onClick={() => updateQuery("")}>清空搜索</button>
          ) : (
            <button type="button" className="button primary compact" onClick={() => openEditor()}><Plus size={17} />新增第一项</button>
          )}
        </div>
      )}

      <button type="button" className="todo-floating-add" aria-label="新增待办" onClick={() => openEditor()}>
        <Plus size={27} />
      </button>

      {undoCompletion && (
        <div className="todo-undo-host" role="status" aria-live="polite">
          <article className="app-toast success todo-undo-toast">
            <CheckCircle2 size={18} />
            <span>已完成“{undoCompletion.title}”</span>
            <button type="button" onClick={() => void undoLastCompletion()}><Undo2 size={15} />撤销</button>
          </article>
        </div>
      )}

      {activeEditor !== undefined && (
        <TodoEditor
          key={activeEditor?.id ?? "new-todo"}
          ownerId={ownerId}
          todo={activeEditor ?? undefined}
          allTodos={todos}
          onClose={() => setTodoToEdit(undefined)}
        />
      )}
    </section>
  );
}

interface TodoSectionProps {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function TodoSection({ title, count, open, onToggle, children }: TodoSectionProps) {
  return (
    <section className="todo-section">
      <button type="button" className="todo-section-toggle" aria-expanded={open} onClick={onToggle}>
        <span>{title}<small>{count}</small></span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && <div className="todo-section-content">{children}</div>}
    </section>
  );
}

interface TodoListProps {
  todos: TodoItem[];
  allowManualMove: boolean;
  busyId: string | null;
  openMenuId: string | null;
  onMenuToggle: (id: string) => void;
  onEdit: (todo: TodoItem) => void;
  onToggleCompleted: (todo: TodoItem) => Promise<void>;
  onTogglePinned: (todo: TodoItem) => Promise<void>;
  onCopy: (todo: TodoItem) => Promise<void>;
  onDelete: (todo: TodoItem) => Promise<void>;
  onMove: (todo: TodoItem, direction: -1 | 1) => Promise<void>;
}

function TodoList(props: TodoListProps) {
  return (
    <div className="todo-list" role="list">
      {props.todos.map((todo, index) => {
        const samePinGroup = props.todos.filter((item) => item.is_pinned === todo.is_pinned);
        const pinIndex = samePinGroup.findIndex((item) => item.id === todo.id);
        return (
          <TodoCard
            key={todo.id}
            todo={todo}
            busy={props.busyId === todo.id}
            menuOpen={props.openMenuId === todo.id}
            showMoveActions={props.allowManualMove}
            canMoveUp={props.allowManualMove && pinIndex > 0}
            canMoveDown={props.allowManualMove && pinIndex >= 0 && pinIndex < samePinGroup.length - 1}
            onMenuToggle={() => props.onMenuToggle(todo.id)}
            onEdit={() => props.onEdit(todo)}
            onToggleCompleted={() => props.onToggleCompleted(todo)}
            onTogglePinned={() => props.onTogglePinned(todo)}
            onCopy={() => props.onCopy(todo)}
            onDelete={() => props.onDelete(todo)}
            onMove={(direction) => props.onMove(todo, direction)}
          />
        );
      })}
    </div>
  );
}

interface TodoCardProps {
  todo: TodoItem;
  busy: boolean;
  menuOpen: boolean;
  showMoveActions: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMenuToggle: () => void;
  onEdit: () => void;
  onToggleCompleted: () => Promise<void>;
  onTogglePinned: () => Promise<void>;
  onCopy: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
}

function TodoCard({
  todo,
  busy,
  menuOpen,
  showMoveActions,
  canMoveUp,
  canMoveDown,
  onMenuToggle,
  onEdit,
  onToggleCompleted,
  onTogglePinned,
  onCopy,
  onDelete,
  onMove
}: TodoCardProps) {
  const completed = Boolean(todo.completed_at);
  return (
    <article
      role="listitem"
      className={`todo-card ${completed ? "completed" : ""} ${busy ? "busy" : ""} ${menuOpen ? "menu-open" : ""}`}
      style={{ "--todo-card-color": normalizeTodoColor(todo.color) } as CSSProperties}
    >
      <button
        type="button"
        className="todo-check-button"
        disabled={busy}
        aria-label={completed ? `恢复待办 ${todo.title}` : `完成待办 ${todo.title}`}
        onClick={() => void onToggleCompleted()}
      >
        <span>{completed && <Check size={16} strokeWidth={3} />}</span>
      </button>
      <button type="button" className="todo-card-body" disabled={busy} aria-label={`编辑待办 ${todo.title}`} onClick={onEdit}>
        <span className="todo-card-title">{todo.title}</span>
        {todo.is_pinned && <small><Pin size={12} />置顶</small>}
      </button>
      <div className="todo-card-menu-shell">
        <button
          type="button"
          className="todo-card-menu-trigger"
          aria-label={`待办“${todo.title}”操作`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={onMenuToggle}
        >
          <MoreHorizontal size={20} />
        </button>
        {menuOpen && (
          <div className="todo-card-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => void onTogglePinned()}>
              {todo.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}{todo.is_pinned ? "取消置顶" : "置顶"}
            </button>
            {showMoveActions && <button type="button" role="menuitem" disabled={!canMoveUp} onClick={() => void onMove(-1)}><ChevronUp size={15} />上移</button>}
            {showMoveActions && <button type="button" role="menuitem" disabled={!canMoveDown} onClick={() => void onMove(1)}><ChevronDown size={15} />下移</button>}
            <button type="button" role="menuitem" onClick={() => void onCopy()}><ClipboardCopy size={15} />复制</button>
            <button type="button" role="menuitem" className="danger" onClick={() => void onDelete()}><Trash2 size={15} />删除</button>
          </div>
        )}
      </div>
    </article>
  );
}

interface TodoEditorProps {
  ownerId: string;
  todo?: TodoItem;
  allTodos: TodoItem[];
  onClose: () => void;
}

function TodoEditor({ ownerId, todo, allTodos, onClose }: TodoEditorProps) {
  const [title, setTitle] = useState(todo?.title ?? "");
  const [color, setColor] = useState(normalizeTodoColor(todo?.color));
  const [pinned, setPinned] = useState(todo?.is_pinned ?? false);
  const [completed, setCompleted] = useState(Boolean(todo?.completed_at));
  const [saving, setSaving] = useState(false);

  async function save() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      showToast("请填写待办内容。", "error");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const record: TodoItem = {
        ...syncFields(todo, ownerId),
        title: normalizedTitle,
        color: normalizeTodoColor(color),
        is_pinned: pinned,
        sort_order: todo?.sort_order ?? nextSortOrder(allTodos),
        completed_at: completed ? (todo?.completed_at ?? new Date().toISOString()) : null
      };
      await putRecordAndQueue("todos", record);
      showToast(todo ? "待办已保存。" : "待办已添加。", "success");
      onClose();
    } catch (error) {
      showToast(errorMessage(error, "保存待办失败，请稍后重试。"), "error", 6000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={todo ? "编辑待办" : "新增待办"} onClose={onClose} className="todo-editor-modal">
      <form className="form-stack todo-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>
          待办内容
          <input
            aria-label="待办内容"
            value={title}
            maxLength={120}
            placeholder="例如：整理本周课程资料"
            onChange={(event) => setTitle(event.target.value)}
          />
          <small>{title.length}/120</small>
        </label>
        <fieldset className="todo-color-fieldset">
          <legend>卡片颜色</legend>
          <div className="todo-color-options">
            {TODO_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={color.toLowerCase() === option.toLowerCase() ? "selected" : ""}
                style={{ backgroundColor: option }}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color.toLowerCase() === option.toLowerCase()}
                onClick={() => setColor(option)}
              >
                {color.toLowerCase() === option.toLowerCase() && <Check size={15} />}
              </button>
            ))}
            <label className="todo-custom-color" title="自定义颜色">
              <span className="todo-visually-hidden">自定义颜色</span>
              <input type="color" aria-label="自定义颜色" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          </div>
        </fieldset>
        <div className="todo-editor-switches">
          <label className="checkbox-label"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />置顶显示</label>
          <label className="checkbox-label"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />标记为已完成</label>
        </div>
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>取消</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? "保存中…" : "保存待办"}</button>
        </div>
      </form>
    </Modal>
  );
}

function compareTodos(left: TodoItem, right: TodoItem): number {
  if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
  if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

function compareCompletedTodos(left: TodoItem, right: TodoItem): number {
  const completionOrder = (right.completed_at ?? "").localeCompare(left.completed_at ?? "");
  return completionOrder || right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
}

function nextSortOrder(todos: TodoItem[]): number {
  const maximum = todos.reduce((current, item) => Math.max(current, Number.isFinite(item.sort_order) ? item.sort_order : 0), 0);
  return maximum + SORT_ORDER_STEP;
}

function normalizeTodoColor(color?: string): string {
  return color && /^#[\da-f]{6}$/i.test(color) ? color : DEFAULT_TODO_COLOR;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
