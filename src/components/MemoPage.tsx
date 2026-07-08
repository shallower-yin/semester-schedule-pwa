import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, FileText, Folder, Grid3X3, List, ListChecks, ListOrdered, Pin, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import { syncFields } from "../lib/identity";
import { toISODate } from "../lib/date";
import { applyMemoLineFormat, continueMemoListOnEnter, toggleMemoChecklistAtCursor } from "../lib/memoFormatting";
import { supabase } from "../lib/supabase";
import type { EventItem, Memo, MemoFolder } from "../types";
import { Modal } from "./Modal";

interface MemoPageProps {
  ownerId: string;
  openMemoId?: string | null;
  onOpenMemoConsumed?: () => void;
}

type FolderFilter = "all" | "trash" | string;
type MemoViewMode = "list" | "grid";
const GRID_PAGE_SIZE = 9;

export function MemoPage({ ownerId, openMemoId, onOpenMemoConsumed }: MemoPageProps) {
  const folders = useLiveQuery(
    () => db.memoFolders.filter((folder) => folder.user_id === ownerId && !folder.deleted_at).sortBy("sort_order"),
    [ownerId]
  ) ?? [];
  const memos = useLiveQuery(
    () => db.memos.filter((memo) => memo.user_id === ownerId).toArray(),
    [ownerId]
  ) ?? [];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FolderFilter>("all");
  const [viewMode, setViewMode] = useState<MemoViewMode>("list");
  const [gridPage, setGridPage] = useState(0);
  const [memoToEdit, setMemoToEdit] = useState<Memo | null | undefined>(undefined);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!openMemoId) return;
    const target = memos.find((memo) => memo.id === openMemoId && !memo.deleted_at);
    if (!target) return;
    setMemoToEdit(target);
    onOpenMemoConsumed?.();
  }, [memos, onOpenMemoConsumed, openMemoId]);

  const visibleMemos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return memos
      .filter((memo) => (filter === "trash" ? Boolean(memo.deleted_at) : !memo.deleted_at))
      .filter((memo) => (filter === "all" || filter === "trash" ? true : memo.folder_id === filter))
      .filter((memo) => {
        if (!normalizedQuery) return true;
        return `${memo.title}\n${memo.content}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
        return right.updated_at.localeCompare(left.updated_at);
      });
  }, [filter, memos, query]);

  const activeMemoCount = memos.filter((memo) => !memo.deleted_at).length;
  const trashMemoCount = memos.filter((memo) => memo.deleted_at).length;
  const gridPageCount = Math.max(1, Math.ceil(visibleMemos.length / GRID_PAGE_SIZE));
  const activeGridPage = Math.min(gridPage, gridPageCount - 1);
  const gridMemos = visibleMemos.slice(activeGridPage * GRID_PAGE_SIZE, activeGridPage * GRID_PAGE_SIZE + GRID_PAGE_SIZE);
  const emptyGridSlots = filter === "trash" ? 0 : GRID_PAGE_SIZE - gridMemos.length;

  function selectFilter(nextFilter: FolderFilter) {
    setFilter(nextFilter);
    setGridPage(0);
  }

  function selectViewMode(nextMode: MemoViewMode) {
    setViewMode(nextMode);
    setGridPage(0);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setGridPage(0);
  }

  async function addFolder() {
    const name = window.prompt("文件夹名称");
    if (!name?.trim()) return;
    const folder: MemoFolder = {
      ...syncFields(),
      name: name.trim(),
      sort_order: folders.length + 1
    };
    await db.memoFolders.put(folder);
    await queueChange("memoFolders", folder.id);
    selectFilter(folder.id);
  }

  async function removeFolder(folder: MemoFolder) {
    if (!window.confirm(`删除文件夹“${folder.name}”？文件夹内备忘录会移到“全部”。`)) return;
    await db.transaction("rw", db.memoFolders, db.memos, db.syncQueue, async () => {
      const deletedFolder = { ...folder, ...syncFields(folder), deleted_at: new Date().toISOString() };
      await db.memoFolders.put(deletedFolder);
      await queueChange("memoFolders", deletedFolder.id, "delete");
      const folderMemos = await db.memos.where("folder_id").equals(folder.id).filter((memo) => memo.user_id === ownerId && !memo.deleted_at).toArray();
      for (const memo of folderMemos) {
        const updated = { ...memo, ...syncFields(memo), deleted_at: memo.deleted_at, folder_id: null };
        await db.memos.put(updated);
        await queueChange("memos", updated.id);
      }
    });
    selectFilter("all");
  }

  async function renameFolder(folder: MemoFolder) {
    const name = window.prompt("新的文件夹名称", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    const updated = { ...folder, ...syncFields(folder), name: name.trim() };
    await db.memoFolders.put(updated);
    await queueChange("memoFolders", updated.id);
    setMessage(`已重命名文件夹为“${updated.name}”。`);
  }

  async function restoreMemo(memo: Memo) {
    const restored = { ...memo, ...syncFields(memo), deleted_at: null };
    await db.memos.put(restored);
    await queueChange("memos", restored.id);
  }

  async function permanentlyDeleteMemo(memo: Memo) {
    if (!window.confirm(`彻底删除备忘录“${memo.title}”？此操作不会进入回收站。`)) return;
    try {
      await permanentlyDeleteRemoteRow("memos", memo.id, memo.user_id);
      await db.transaction("rw", db.memos, db.syncQueue, async () => {
        await db.memos.delete(memo.id);
        const queued = await db.syncQueue
          .where("table_name")
          .equals("memos")
          .and((item) => item.record_id === memo.id)
          .toArray();
        await db.syncQueue.bulkDelete(queued.map((item) => item.id));
      });
      setMessage("备忘录已彻底删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "彻底删除失败");
    }
  }

  async function emptyTrash() {
    const trashed = memos.filter((memo) => memo.deleted_at);
    if (!trashed.length) return;
    if (!window.confirm(`彻底删除回收站中的 ${trashed.length} 条备忘录？`)) return;
    try {
      for (const memo of trashed) await permanentlyDeleteRemoteRow("memos", memo.id, memo.user_id);
      await db.transaction("rw", db.memos, db.syncQueue, async () => {
        await db.memos.bulkDelete(trashed.map((memo) => memo.id));
        const queued = await db.syncQueue.where("table_name").equals("memos").toArray();
        await db.syncQueue.bulkDelete(queued.filter((item) => trashed.some((memo) => memo.id === item.record_id)).map((item) => item.id));
      });
      setMessage(`已彻底删除 ${trashed.length} 条备忘录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空回收站失败");
    }
  }

  async function createEventFromMemo(memo: Memo) {
    const today = toISODate(new Date());
    const eventItem: EventItem = {
      ...syncFields(),
      event_type: "event",
      title: memo.title,
      start_date: today,
      end_date: today,
      start_time: "09:00",
      end_time: "09:00",
      all_day: false,
      category_id: null,
      color: "#e36b32",
      note: memo.content,
      recurrence_type: "none",
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: false,
      reminder_minutes_before: 10,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    await db.events.put(eventItem);
    await queueChange("events", eventItem.id);
    setMessage(`已从“${memo.title}”创建今天事项。`);
  }

  return (
    <section className="memo-page">
      <aside className="memo-sidebar">
        <div className="memo-search">
          <Search size={17} />
          <input placeholder="搜索备忘录" value={query} onChange={(event) => updateQuery(event.target.value)} />
        </div>
        <div className="memo-sidebar-section">
          <span>展示视图</span>
          <div className="memo-view-toggle">
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              aria-pressed={viewMode === "list"}
              onClick={() => selectViewMode("list")}
              title="列表视图"
            >
              <List size={15} />列表
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              aria-pressed={viewMode === "grid"}
              onClick={() => selectViewMode("grid")}
              title="九宫格视图"
            >
              <Grid3X3 size={15} />九宫格
            </button>
          </div>
        </div>
        <div className="memo-sidebar-section">
          <div className="memo-sidebar-title">
            <span>文件夹</span>
            <button className="text-button" onClick={() => void addFolder()}><Plus size={14} />添加</button>
          </div>
          <button className={filter === "all" ? "active" : ""} onClick={() => selectFilter("all")}>
            <FileText size={18} /><span>全部</span><small>{activeMemoCount}</small>
          </button>
          {folders.map((folder) => (
            <button key={folder.id} className={filter === folder.id ? "active" : ""} onClick={() => selectFilter(folder.id)}>
              <Folder size={18} /><span>{folder.name}</span>
              <small>{memos.filter((memo) => !memo.deleted_at && memo.folder_id === folder.id).length}</small>
              <span
                className="memo-folder-edit"
                role="button"
                tabIndex={0}
                title="重命名文件夹"
                onClick={(event) => {
                  event.stopPropagation();
                  void renameFolder(folder);
                }}
              >
                ✎
              </span>
              <span
                className="memo-folder-delete"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void removeFolder(folder);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button className={filter === "trash" ? "active" : ""} onClick={() => selectFilter("trash")}>
            <Trash2 size={18} /><span>回收站</span><small>{trashMemoCount}</small>
          </button>
        </div>
      </aside>

      <div className="memo-main">
        <div className="page-heading memo-heading">
          <div>
            <h1>备忘录</h1>
            <p>记录临时想法、复习计划和需要保留的文字资料。</p>
          </div>
          <div className="inline-actions">
            {filter === "trash" && trashMemoCount > 0 && <button className="button danger-button compact" onClick={() => void emptyTrash()}><Trash2 size={16} />清空回收站</button>}
            <button className="button primary compact" onClick={() => setMemoToEdit(null)}><Plus size={17} />新增备忘录</button>
          </div>
        </div>
        {message && <p className="status-message memo-status">{message}</p>}
        {visibleMemos.length ? (
          viewMode === "grid" ? (
            <>
              <div className="memo-grid-toolbar">
                <span>九宫格 {activeGridPage + 1} / {gridPageCount}</span>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button secondary compact"
                    disabled={activeGridPage === 0}
                    onClick={() => setGridPage((page) => Math.max(0, page - 1))}
                  >
                    上一组
                  </button>
                  <button
                    type="button"
                    className="button secondary compact"
                    disabled={activeGridPage >= gridPageCount - 1}
                    onClick={() => setGridPage((page) => Math.min(gridPageCount - 1, page + 1))}
                  >
                    下一组
                  </button>
                </div>
              </div>
              <div className="memo-grid" role="list" aria-label="九宫格备忘录">
                {gridMemos.map((memo) => (
                  <MemoCard
                    key={memo.id}
                    memo={memo}
                    mode="grid"
                    onEdit={setMemoToEdit}
                    onRestore={restoreMemo}
                    onDelete={permanentlyDeleteMemo}
                    onCreateEvent={createEventFromMemo}
                  />
                ))}
                {Array.from({ length: emptyGridSlots }, (_, index) => (
                  <div className="memo-grid-empty" key={`empty-${activeGridPage}-${index}`} role="listitem">
                    <button type="button" onClick={() => setMemoToEdit(null)}>
                      <Plus size={18} />
                      <span>新增备忘录</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="memo-list" role="list" aria-label="备忘录列表">
              {visibleMemos.map((memo) => (
                <MemoCard
                  key={memo.id}
                  memo={memo}
                  mode="list"
                  onEdit={setMemoToEdit}
                  onRestore={restoreMemo}
                  onDelete={permanentlyDeleteMemo}
                  onCreateEvent={createEventFromMemo}
                />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state compact-empty">
            <FileText size={34} />
            <h2>{filter === "trash" ? "回收站为空" : "还没有备忘录"}</h2>
            <p>{filter === "trash" ? "删除的备忘录会在这里保留。" : "新增一条备忘录，用来保存想法、材料或复习笔记。"}</p>
          </div>
        )}
      </div>

      {memoToEdit !== undefined && (
        <MemoDialog
          folders={folders}
          memo={memoToEdit ?? undefined}
          initialFolderId={filter !== "all" && filter !== "trash" ? filter : null}
          onClose={() => setMemoToEdit(undefined)}
        />
      )}
    </section>
  );
}

interface MemoCardProps {
  memo: Memo;
  mode: MemoViewMode;
  onEdit: (memo: Memo) => void;
  onRestore: (memo: Memo) => Promise<void>;
  onDelete: (memo: Memo) => Promise<void>;
  onCreateEvent: (memo: Memo) => Promise<void>;
}

function MemoCard({ memo, mode, onEdit, onRestore, onDelete, onCreateEvent }: MemoCardProps) {
  return (
    <article
      className={`memo-card ${mode === "grid" ? "memo-card-grid" : ""}`}
      role="listitem"
      onClick={() => !memo.deleted_at && onEdit(memo)}
    >
      <div className="memo-card-topline">
        <time>{memo.updated_at.slice(0, 10).replaceAll("-", "/")}</time>
        {memo.is_pinned && <span className="memo-pin"><Pin size={13} />置顶</span>}
      </div>
      <h2>{memo.title}</h2>
      <p>{memo.content || "无正文"}</p>
      {memo.deleted_at ? (
        <div className="memo-card-actions">
          <button
            className="button secondary compact"
            onClick={(event) => {
              event.stopPropagation();
              void onRestore(memo);
            }}
          >
            <RotateCcw size={15} />恢复
          </button>
          <button
            className="button danger-button compact"
            onClick={(event) => {
              event.stopPropagation();
              void onDelete(memo);
            }}
          >
            <Trash2 size={15} />彻底删除
          </button>
        </div>
      ) : (
        <div className="memo-card-actions">
          <button
            className="button secondary compact"
            onClick={(event) => {
              event.stopPropagation();
              void onCreateEvent(memo);
            }}
          >
            <CalendarPlus size={15} />转事项
          </button>
        </div>
      )}
    </article>
  );
}

async function permanentlyDeleteRemoteRow(table: "memos" | "memo_folders", id: string, userId: string) {
  if (userId === "local") return;
  if (!navigator.onLine) throw new Error("当前离线，无法彻底删除云端记录。请联网后重试。");
  if (!supabase) throw new Error("云端未配置，无法彻底删除已登录账号的数据。");
  const { error } = await supabase.from(table).delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(`${table} 云端彻底删除失败：${error.message}`);
}

interface MemoDialogProps {
  folders: MemoFolder[];
  memo?: Memo;
  initialFolderId: string | null;
  onClose: () => void;
}

function MemoDialog({ folders, memo, initialFolderId, onClose }: MemoDialogProps) {
  const [title, setTitle] = useState(memo?.title ?? "");
  const [content, setContent] = useState(memo?.content ?? "");
  const [folderId, setFolderId] = useState(memo?.folder_id ?? initialFolderId ?? "");
  const [isPinned, setIsPinned] = useState(memo?.is_pinned ?? false);
  const [message, setMessage] = useState("");
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualLines = useMemo(() => buildMemoVisualLines(content), [content]);

  function focusTextareaAt(cursor: number) {
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setMessage("请填写标题。");
      return;
    }
    const record: Memo = {
      ...syncFields(memo),
      folder_id: folderId || null,
      title: title.trim(),
      content,
      is_pinned: isPinned
    };
    await db.memos.put(record);
    await queueChange("memos", record.id);
    onClose();
  }

  async function remove() {
    if (!memo || !window.confirm(`删除备忘录“${memo.title}”？`)) return;
    await db.memos.put({ ...memo, ...syncFields(memo), deleted_at: new Date().toISOString() });
    await queueChange("memos", memo.id, "delete");
    onClose();
  }

  function applyLineFormat(kind: "numbered" | "checklist") {
    const textarea = textareaRef.current;
    const edit = applyMemoLineFormat(
      content,
      textarea?.selectionStart ?? content.length,
      textarea?.selectionEnd ?? content.length,
      kind
    );
    setContent(edit.content);
    focusTextareaAt(edit.cursor);
  }

  function handleContentKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const edit = continueMemoListOnEnter(content, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    if (!edit) return;
    event.preventDefault();
    setContent(edit.content);
    focusTextareaAt(edit.cursor);
  }

  function handleContentClick(event: React.MouseEvent<HTMLTextAreaElement>) {
    const edit = toggleMemoChecklistAtCursor(content, event.currentTarget.selectionStart);
    if (!edit) return;
    setContent(edit.content);
    focusTextareaAt(edit.cursor);
  }

  function handleContentScroll(event: React.UIEvent<HTMLTextAreaElement>) {
    setTextareaScrollTop(event.currentTarget.scrollTop);
  }

  return (
    <Modal title={memo ? "编辑备忘录" : "新增备忘录"} onClose={onClose} wide>
      <form className="form-stack" onSubmit={save}>
        <label>标题<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>文件夹
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">全部 / 不放入文件夹</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <label className="checkbox-label"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />置顶</label>
        <div className="memo-editor-field">
          <span>正文</span>
          <div className="memo-editor-toolbar">
            <button type="button" className="button secondary compact" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLineFormat("numbered")}><ListOrdered size={15} />编号</button>
            <button type="button" className="button secondary compact" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLineFormat("checklist")}><ListChecks size={15} />待办</button>
          </div>
          <div className="memo-textarea-shell">
            <div className="memo-textarea-visual" aria-hidden="true">
              <div style={{ transform: `translateY(-${textareaScrollTop}px)` }}>
                {visualLines.map((line, index) => (
                  <div key={index} className={`memo-visual-line ${line.completed ? "completed" : ""}`}>
                    {line.kind === "circle" ? (
                      <>
                        {line.indent}<span className={`memo-visual-marker ${line.completed ? "checked" : ""}`}>○</span>{line.gap}
                        <span className={line.completed ? "memo-visual-text completed" : "memo-visual-text"}>{line.text || "\u00a0"}</span>
                      </>
                    ) : (
                      line.text || "\u00a0"
                    )}
                  </div>
                ))}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="memo-textarea"
              rows={12}
              aria-label="正文"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onClick={handleContentClick}
              onKeyDown={handleContentKeyDown}
              onScroll={handleContentScroll}
            />
          </div>
        </div>
        {message && <p className="auth-message error">{message}</p>}
        <div className="form-actions split">
          <div>{memo && <button type="button" className="button danger-button" onClick={() => void remove()}>删除备忘录</button>}</div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>取消</button>
            <button className="button primary">保存备忘录</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

type MemoVisualLine =
  | { kind: "circle"; indent: string; gap: string; text: string; completed: boolean }
  | { kind: "plain"; text: string; completed: false };

function buildMemoVisualLines(content: string): MemoVisualLine[] {
  const lines = content.split(/\r?\n/);
  return lines.map((line) => {
    const circleMatch = /^(\s*)([○◯●])(\s*)(.*)$/.exec(line);
    if (circleMatch) {
      return {
        kind: "circle",
        indent: circleMatch[1],
        gap: circleMatch[3] || " ",
        text: circleMatch[4],
        completed: circleMatch[2] === "●"
      };
    }
    return { kind: "plain", text: line, completed: false };
  });
}
