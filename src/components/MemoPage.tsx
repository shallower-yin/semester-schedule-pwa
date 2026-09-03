import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Copy, FileText, Folder, Grid3X3, Image as ImageIcon, List, ListChecks, ListOrdered, Pin, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, putRecordAndQueue } from "../db";
import { syncFields } from "../lib/identity";
import { toISODate } from "../lib/date";
import { hardDeleteLocalRecord, hardDeleteLocalRecords } from "../lib/hardDelete";
import { applyMemoLineFormat, continueMemoListOnEnter, getMemoChecklistMarkerRanges, getMemoChecklistStats, memoLineSelectionRange, toggleMemoChecklistAtCursor } from "../lib/memoFormatting";
import { getMemoImageUrls, MEMO_IMAGE_LIMIT, normalizeMemoImages, removeMemoImages, uploadMemoImage, validateMemoImage } from "../lib/memoImages";
import { currentOwnerRecord } from "../lib/liveQueryScope";
import { findSearchNavigationMatch, normalizeSearchText, searchMatchFieldClass, type SearchNavigationMatch } from "../lib/searchNavigation";
import { showToast } from "../lib/toast";
import type { EventItem, Memo, MemoFolder, MemoImage } from "../types";
import { AttachmentSourcePicker } from "./AttachmentSourcePicker";
import { MemoImagePreview } from "./MemoImagePreview";
import { Modal } from "./Modal";

interface MemoPageProps {
  ownerId: string;
  openMemoId?: string | null;
  openSearchMatch?: SearchNavigationMatch | null;
  onOpenMemoConsumed?: () => void;
  onSearchMatchClosed?: () => void;
}

type FolderFilter = "all" | "uncheckedTodos" | string;
type MemoViewMode = "list" | "grid";
const GRID_PAGE_SIZE = 9;
// Keep the single-click action behind the common Windows 500 ms double-click
// window so a deliberately slow double-click never changes checklist data.
const MEMO_CHECKLIST_CLICK_DELAY_MS = 550;
const MEMO_POINTER_DRAG_THRESHOLD_PX = 5;

interface MemoContentPointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  markerCursor: number | null;
  hadSelection: boolean;
  dragged: boolean;
}

function useMemoEditorInstanceToken(identity: string, activeTokenRef: React.MutableRefObject<string>): string {
  const previousIdentityRef = useRef("closed");
  const generationRef = useRef(0);
  const tokenRef = useRef("closed");
  if (previousIdentityRef.current !== identity) {
    previousIdentityRef.current = identity;
    generationRef.current += 1;
    tokenRef.current = identity === "closed" ? "closed" : `${identity}:${generationRef.current}`;
  }
  activeTokenRef.current = tokenRef.current;
  return tokenRef.current;
}

export function MemoPage({ ownerId, openMemoId, openSearchMatch, onOpenMemoConsumed, onSearchMatchClosed }: MemoPageProps) {
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
  const [memoSearchMatch, setMemoSearchMatch] = useState<SearchNavigationMatch | null>(null);
  const [message, setMessage] = useState("");
  const previousOwnerIdRef = useRef(ownerId);
  const memoEditorTokenRef = useRef("closed");

  useEffect(() => {
    if (!openMemoId) return;
    const target = memos.find((memo) => memo.id === openMemoId && memo.user_id === ownerId && !memo.deleted_at);
    if (!target) return;
    setMemoSearchMatch(openSearchMatch ?? null);
    setMemoToEdit(target);
    onOpenMemoConsumed?.();
  }, [memos, onOpenMemoConsumed, openMemoId, openSearchMatch, ownerId]);

  useEffect(() => {
    if (previousOwnerIdRef.current === ownerId) return;
    previousOwnerIdRef.current = ownerId;
    setMemoSearchMatch(null);
    setMemoToEdit(undefined);
    onSearchMatchClosed?.();
  }, [onSearchMatchClosed, ownerId]);

  useEffect(() => {
    const legacyDeletedIds = memos.filter((memo) => memo.deleted_at).map((memo) => memo.id);
    if (!legacyDeletedIds.length) return;
    void hardDeleteLocalRecords("memos", legacyDeletedIds);
  }, [memos]);

  const visibleMemos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return memos
      .filter((memo) => !memo.deleted_at)
      .filter((memo) => {
        if (filter === "all") return true;
        if (filter === "uncheckedTodos") return getMemoChecklistStats(memo.content).incomplete > 0;
        return memo.folder_id === filter;
      })
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
  const uncheckedTodoCount = memos
    .filter((memo) => !memo.deleted_at)
    .reduce((total, memo) => total + getMemoChecklistStats(memo.content).incomplete, 0);
  const uncheckedTodoMemoCount = memos
    .filter((memo) => !memo.deleted_at && getMemoChecklistStats(memo.content).incomplete > 0)
    .length;
  const gridPageCount = Math.max(1, Math.ceil(visibleMemos.length / GRID_PAGE_SIZE));
  const activeGridPage = Math.min(gridPage, gridPageCount - 1);
  const gridMemos = visibleMemos.slice(activeGridPage * GRID_PAGE_SIZE, activeGridPage * GRID_PAGE_SIZE + GRID_PAGE_SIZE);
  const emptyGridSlots = GRID_PAGE_SIZE - gridMemos.length;
  const memoToEditForOwner = currentOwnerRecord(memoToEdit, ownerId);
  const memoEditorIdentity = memoToEditForOwner === undefined ? "closed" : `${ownerId}:${memoToEditForOwner?.id ?? "new"}`;
  const memoEditorToken = useMemoEditorInstanceToken(memoEditorIdentity, memoEditorTokenRef);

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

  function openMemo(memo: Memo) {
    setMemoSearchMatch(findSearchNavigationMatch([
      { field: "title", label: "标题", value: memo.title },
      { field: "content", label: "正文", value: memo.content }
    ], query));
    setMemoToEdit(memo);
  }

  async function addFolder() {
    const name = window.prompt("文件夹名称");
    if (!name?.trim()) return;
    const folder: MemoFolder = {
      ...syncFields(undefined, ownerId),
      name: name.trim(),
      sort_order: folders.length + 1
    };
    await putRecordAndQueue("memoFolders", folder);
    selectFilter(folder.id);
  }

  async function removeFolder(folder: MemoFolder) {
    if (!window.confirm(`确定彻底删除文件夹“${folder.name}”吗？文件夹内备忘录会移到“全部”，文件夹本身无法恢复。`)) return;
    const operationOwnerId = ownerId;
    await db.transaction("rw", db.memoFolders, db.memos, db.syncQueue, async () => {
      const folderMemos = await db.memos.where("folder_id").equals(folder.id).filter((memo) => memo.user_id === operationOwnerId && !memo.deleted_at).toArray();
      for (const memo of folderMemos) {
        const updated = { ...memo, ...syncFields(memo, operationOwnerId), deleted_at: memo.deleted_at, folder_id: null };
        await putRecordAndQueue("memos", updated);
      }
      await hardDeleteLocalRecord("memoFolders", folder.id);
    });
    showToast("文件夹已彻底删除。", "success");
    selectFilter("all");
  }

  async function renameFolder(folder: MemoFolder) {
    const name = window.prompt("新的文件夹名称", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    const updated = { ...folder, ...syncFields(folder), name: name.trim() };
    await putRecordAndQueue("memoFolders", updated);
    setMessage(`已重命名文件夹为“${updated.name}”。`);
  }

  async function createEventFromMemo(memo: Memo) {
    const today = toISODate(new Date());
    const eventItem: EventItem = {
      ...syncFields(undefined, ownerId),
      event_type: "event",
      title: memo.title,
      start_date: today,
      end_date: today,
      start_time: "09:00",
      end_time: "09:00",
      all_day: false,
      category_id: null,
      color: "#e36b32",
      location: "",
      note: memo.content,
      recurrence_type: "none",
      recurrence_until: null,
      recurrence_interval: 1,
      reminder_enabled: false,
      reminder_minutes_before: 10,
      timezone: "Asia/Shanghai"
    };
    await putRecordAndQueue("events", eventItem);
    setMessage(`已从“${memo.title}”创建今天事项。`);
    showToast("已创建今天事项。", "success");
  }

  return (
    <section className="memo-page">
      <aside className="memo-sidebar">
        <div className="memo-search">
          <Search size={17} />
          <input placeholder="搜索备忘录" value={query} onChange={(event) => updateQuery(event.target.value)} />
        </div>
        <div className="memo-sidebar-section memo-view-section">
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
        <div className="memo-sidebar-section memo-folder-section">
          <div className="memo-sidebar-title">
            <span>文件夹</span>
            <button className="text-button" onClick={() => void addFolder()}><Plus size={14} />添加</button>
          </div>
          <button className={filter === "all" ? "active" : ""} onClick={() => selectFilter("all")}>
            <FileText size={18} /><span>全部</span><small>{activeMemoCount}</small>
          </button>
          <button className={filter === "uncheckedTodos" ? "active" : ""} onClick={() => selectFilter("uncheckedTodos")}>
            <ListChecks size={18} /><span>未完成待办</span><small>{uncheckedTodoCount}</small>
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
        </div>
      </aside>

      <div className="memo-main">
        <div className="page-heading memo-heading">
          <div>
            <h1>备忘录</h1>
            <p><span className="memo-heading-intro">记录临时想法、复习计划和需要保留的文字资料。</span>未完成待办 {uncheckedTodoCount} 项，分布在 {uncheckedTodoMemoCount} 条备忘录中。</p>
          </div>
          <div className="inline-actions">
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
                    onEdit={openMemo}
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
                  onEdit={openMemo}
                  onCreateEvent={createEventFromMemo}
                />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state compact-empty">
            <FileText size={34} />
            <h2>{query || filter !== "all" ? "没有匹配的备忘录" : "还没有备忘录"}</h2>
            <p>{query || filter !== "all" ? "清空筛选后再查看全部备忘录。" : "先新增一条备忘录，用来保存想法、材料或复习笔记。"}</p>
            {query || filter !== "all" ? (
              <button type="button" className="button secondary compact" onClick={() => { updateQuery(""); selectFilter("all"); }}>清空筛选</button>
            ) : (
              <button type="button" className="button primary compact" onClick={() => setMemoToEdit(null)}><Plus size={17} />开始记录</button>
            )}
          </div>
        )}
      </div>

      {memoToEditForOwner !== undefined && (
        <MemoDialog
          key={memoEditorToken}
          ownerId={ownerId}
          folders={folders}
          memo={memoToEditForOwner ?? undefined}
          searchMatch={memoSearchMatch}
          initialFolderId={filter !== "all" && filter !== "uncheckedTodos" ? filter : null}
          onClose={() => {
            if (memoEditorTokenRef.current !== memoEditorToken) return;
            setMemoSearchMatch(null);
            onSearchMatchClosed?.();
            setMemoToEdit(undefined);
          }}
        />
      )}
    </section>
  );
}

interface MemoCardProps {
  memo: Memo;
  mode: MemoViewMode;
  onEdit: (memo: Memo) => void;
  onCreateEvent: (memo: Memo) => Promise<void>;
}

function MemoCard({ memo, mode, onEdit, onCreateEvent }: MemoCardProps) {
  const checklistStats = getMemoChecklistStats(memo.content);
  return (
    <article
      className={`memo-card ${mode === "grid" ? "memo-card-grid" : ""}`}
      role="listitem"
      onClick={() => onEdit(memo)}
    >
      <div className="memo-card-topline">
        <time>{memo.updated_at.slice(0, 10).replaceAll("-", "/")}</time>
        {memo.is_pinned && <span className="memo-pin"><Pin size={13} />置顶</span>}
      </div>
      <h2>{memo.title}</h2>
      {checklistStats.incomplete > 0 && <span className="memo-todo-badge">未完成待办 {checklistStats.incomplete}</span>}
      {Boolean(memo.images?.length) && <span className="memo-image-badge"><ImageIcon size={13} />图片 {memo.images!.length} 张</span>}
      <p>{memo.content || "无正文"}</p>
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
    </article>
  );
}

interface MemoDialogProps {
  ownerId: string;
  folders: MemoFolder[];
  memo?: Memo;
  searchMatch?: SearchNavigationMatch | null;
  initialFolderId: string | null;
  onClose: () => void;
}

function MemoDialog({ ownerId, folders, memo, searchMatch, initialFolderId, onClose }: MemoDialogProps) {
  const [draftMemoId] = useState(() => memo?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(memo?.title ?? "");
  const [content, setContent] = useState(() => normalizeSearchText(memo?.content ?? ""));
  const [folderId, setFolderId] = useState(memo?.folder_id ?? initialFolderId ?? "");
  const [isPinned, setIsPinned] = useState(memo?.is_pinned ?? false);
  const [images, setImages] = useState<MemoImage[]>(() => normalizeMemoImages(memo?.images));
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [message, setMessage] = useState("");
  const [searchHighlightVisible, setSearchHighlightVisible] = useState(Boolean(searchMatch));
  const [lineHighlight, setLineHighlight] = useState<{ top: number; height: number } | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const contentPointerTypeRef = useRef("mouse");
  const contentPointerGestureRef = useRef<MemoContentPointerGesture | null>(null);
  const pendingChecklistToggleRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const newImagePathsRef = useRef<string[]>([]);
  const removedExistingPathsRef = useRef<string[]>([]);
  const savedRef = useRef(false);
  const savingRef = useRef(false);

  function clearPendingChecklistToggle() {
    if (pendingChecklistToggleRef.current === null) return;
    window.clearTimeout(pendingChecklistToggleRef.current);
    pendingChecklistToggleRef.current = null;
  }

  useEffect(() => {
    let active = true;
    void getMemoImageUrls(images)
      .then((urls) => {
        if (active) setImageUrls((current) => ({ ...current, ...urls }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [images]);

  useEffect(() => () => {
    mountedRef.current = false;
    clearPendingChecklistToggle();
    // The database commit may still be using the newly uploaded paths.  Its
    // continuation owns cleanup after it settles; deleting here would leave a
    // successfully saved memo pointing at an object that no longer exists.
    if (savingRef.current) return;
    const cleanupPaths = [
      ...newImagePathsRef.current,
      ...(savedRef.current ? removedExistingPathsRef.current : [])
    ];
    if (cleanupPaths.length) void removeMemoImages(cleanupPaths).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!searchMatch) return;
    setSearchHighlightVisible(true);
    const frame = window.requestAnimationFrame(() => {
      if (searchMatch.field === "content" && textareaRef.current) {
        const textarea = textareaRef.current;
        const currentContent = contentRef.current;
        const start = Math.min(currentContent.length, Math.max(0, searchMatch.start));
        const end = Math.min(currentContent.length, Math.max(start, searchMatch.end));
        textarea.setSelectionRange(start, end, "forward");
        setLineHighlight(positionMemoSearchLine(textarea, currentContent, searchMatch));
      } else if (searchMatch.field === "title") {
        titleInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    const timer = window.setTimeout(() => {
      setSearchHighlightVisible(false);
      setLineHighlight(null);
    }, 2600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [searchMatch]);

  function dismissSearchHighlight() {
    setSearchHighlightVisible(false);
    setLineHighlight(null);
  }

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
    clearPendingChecklistToggle();
    if (!title.trim()) {
      setMessage("请填写标题。");
      return;
    }
    const record: Memo = {
      ...syncFields(memo ?? { id: draftMemoId, user_id: ownerId, created_at: new Date().toISOString(), version: 0 }, ownerId),
      folder_id: folderId || null,
      title: title.trim(),
      content,
      is_pinned: isPinned,
      images
    };
    savingRef.current = true;
    try {
      await putRecordAndQueue("memos", record);
    } catch (error) {
      savingRef.current = false;
      if (!mountedRef.current) {
        const orphanedPaths = [...newImagePathsRef.current];
        newImagePathsRef.current = [];
        if (orphanedPaths.length) void removeMemoImages(orphanedPaths).catch(() => undefined);
        return;
      }
      setMessage(error instanceof Error ? error.message : "保存备忘录失败，请重试。");
      return;
    }
    savedRef.current = true;
    const retainedPaths = new Set(images.map((image) => image.path));
    newImagePathsRef.current = newImagePathsRef.current.filter((path) => !retainedPaths.has(path));
    const cleanupPaths = [...removedExistingPathsRef.current, ...newImagePathsRef.current];
    if (cleanupPaths.length) {
      try {
        await removeMemoImages(cleanupPaths);
        removedExistingPathsRef.current = [];
        newImagePathsRef.current = [];
      } catch (error) {
        savingRef.current = false;
        if (mountedRef.current) {
          setMessage(error instanceof Error ? `备忘录已保存，但图片清理失败：${error.message}` : "备忘录已保存，但图片清理失败，请重试保存。");
        }
        return;
      }
    }
    savingRef.current = false;
    if (mountedRef.current) onClose();
  }

  async function remove() {
    if (!memo || !window.confirm(`确定删除备忘录“${memo.title}”吗？删除会同步到其他设备且无法恢复。`)) return;
    try {
      await removeMemoImages(normalizeMemoImages(memo.images).map((image) => image.path));
      await hardDeleteLocalRecord("memos", memo.id);
      showToast("备忘录已删除。", "success");
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除备忘录失败，请重试。");
    }
  }

  async function addImages(fileList: FileList | null) {
    if (!fileList?.length) return;
    if (ownerId === "local") {
      setMessage("登录账号后才能插入图片，并同步到其他设备。");
      return;
    }
    const files = Array.from(fileList).slice(0, Math.max(0, MEMO_IMAGE_LIMIT - images.length));
    if (!files.length) {
      setMessage(`每条备忘录最多插入 ${MEMO_IMAGE_LIMIT} 张图片。`);
      return;
    }
    setUploadingImages(true);
    setMessage("");
    try {
      for (const file of files) {
        validateMemoImage(file);
        const image = await uploadMemoImage({ userId: ownerId, memoId: draftMemoId, file });
        if (!mountedRef.current) {
          await removeMemoImages([image.path]).catch(() => undefined);
          break;
        }
        newImagePathsRef.current.push(image.path);
        setImages((current) => [...current, image]);
      }
    } catch (error) {
      if (mountedRef.current) setMessage(error instanceof Error ? error.message : "插入图片失败，请重试。");
    } finally {
      if (mountedRef.current) setUploadingImages(false);
    }
  }

  function removeImageFromDraft(image: MemoImage) {
    setImages((current) => current.filter((item) => item.path !== image.path));
    setImageUrls((current) => {
      const next = { ...current };
      delete next[image.path];
      return next;
    });
    if (!newImagePathsRef.current.includes(image.path)) removedExistingPathsRef.current.push(image.path);
  }

  function applyLineFormat(kind: "numbered" | "checklist") {
    clearPendingChecklistToggle();
    const textarea = textareaRef.current;
    const edit = applyMemoLineFormat(
      content,
      textarea?.selectionStart ?? content.length,
      textarea?.selectionEnd ?? content.length,
      kind
    );
    dismissSearchHighlight();
    setContent(edit.content);
    focusTextareaAt(edit.cursor);
  }

  function handleContentKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    clearPendingChecklistToggle();
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const edit = continueMemoListOnEnter(content, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    if (!edit) return;
    event.preventDefault();
    dismissSearchHighlight();
    setContent(edit.content);
    focusTextareaAt(edit.cursor);
  }

  function handleContentClick(event: React.MouseEvent<HTMLTextAreaElement>) {
    if (event.detail > 1) {
      clearPendingChecklistToggle();
      contentPointerGestureRef.current = null;
      return;
    }
    const gesture = contentPointerGestureRef.current;
    contentPointerGestureRef.current = null;
    if (
      !gesture
      || gesture.dragged
      || gesture.hadSelection
      || gesture.markerCursor === null
      || event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
    ) return;

    const markerCursor = gesture.markerCursor;
    clearPendingChecklistToggle();
    pendingChecklistToggleRef.current = window.setTimeout(() => {
      pendingChecklistToggleRef.current = null;
      const textarea = textareaRef.current;
      if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return;
      const edit = toggleMemoChecklistAtCursor(contentRef.current, markerCursor);
      if (!edit) return;
      dismissSearchHighlight();
      setContent(edit.content);
      focusTextareaAt(edit.cursor);
    }, MEMO_CHECKLIST_CLICK_DELAY_MS);
  }

  function handleContentDoubleClick(event: React.MouseEvent<HTMLTextAreaElement>) {
    clearPendingChecklistToggle();
    contentPointerGestureRef.current = null;
    if (contentPointerTypeRef.current === "touch") return;
    event.preventDefault();
    const range = memoLineSelectionRange(content, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    event.currentTarget.setSelectionRange(range.start, range.end, "forward");
  }

  async function copyFullText() {
    const value = [title.trim(), content.trimEnd()].filter(Boolean).join("\n\n");
    if (!value) {
      showToast("没有可复制的内容。", "error");
      return;
    }
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(value);
      else copyTextFallback(value);
      showToast("已复制全文。", "success");
    } catch {
      copyTextFallback(value);
      showToast("已复制全文。", "success");
    }
  }

  return (
    <Modal
      title={memo ? "编辑备忘录" : "新增备忘录"}
      onClose={onClose}
      wide
      headerExtra={<label className="memo-pin-control"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />置顶</label>}
    >
      <form className="form-stack memo-dialog-form" onSubmit={save}>
        <label className={`memo-meta-row ${searchHighlightVisible ? searchMatchFieldClass(searchMatch, "title") : ""}`.trim()}>
          <span>标题</span>
          <input
            ref={titleInputRef}
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              dismissSearchHighlight();
            }}
          />
        </label>
        <label className="memo-meta-row"><span>文件夹</span>
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">全部 / 不放入文件夹</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <div className="memo-editor-field">
          <div className="memo-editor-heading">
            <span>正文</span>
            <div className="memo-editor-toolbar">
              {searchHighlightVisible && searchMatch?.field === "content" && (
                <span className="memo-search-location" role="status">已定位到第 {searchMatch.line + 1} 行</span>
              )}
              <button type="button" className="button secondary compact" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLineFormat("numbered")}><ListOrdered size={15} />编号</button>
              <button type="button" className="button secondary compact" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLineFormat("checklist")}><ListChecks size={15} />待办</button>
              <AttachmentSourcePicker
                imageAccept="image/jpeg,image/png,image/webp,image/gif"
                documentAccept="image/jpeg,image/png,image/webp,image/gif"
                label={uploadingImages ? "上传中" : "插入图片"}
                ariaLabel="插入备忘录图片"
                disabled={uploadingImages || images.length >= MEMO_IMAGE_LIMIT}
                onFiles={addImages}
              />
              <span className="memo-character-count">{Array.from(content).length} 个字符</span>
            </div>
          </div>
          <div className="memo-textarea-shell">
            {searchHighlightVisible && lineHighlight && (
              <span
                className="memo-search-line-highlight"
                data-testid="memo-search-line-highlight"
                style={{ top: `${lineHighlight.top}px`, height: `${lineHighlight.height}px` }}
              />
            )}
            <textarea
              ref={textareaRef}
              className="memo-textarea"
              rows={12}
              aria-label="正文"
              value={content}
              onChange={(event) => {
                clearPendingChecklistToggle();
                setContent(event.target.value);
                dismissSearchHighlight();
              }}
              onPointerDown={(event) => {
                clearPendingChecklistToggle();
                contentPointerTypeRef.current = event.pointerType;
                contentPointerGestureRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  markerCursor: event.button === 0
                    ? memoChecklistMarkerAtPoint(event.currentTarget, contentRef.current, event.clientX, event.clientY)
                    : null,
                  hadSelection: event.currentTarget.selectionStart !== event.currentTarget.selectionEnd,
                  dragged: false
                };
              }}
              onPointerMove={(event) => {
                const gesture = contentPointerGestureRef.current;
                if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragged) return;
                const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
                if (distance >= MEMO_POINTER_DRAG_THRESHOLD_PX) gesture.dragged = true;
              }}
              onPointerCancel={() => {
                contentPointerGestureRef.current = null;
              }}
              onBlur={clearPendingChecklistToggle}
              onClick={handleContentClick}
              onDoubleClick={handleContentDoubleClick}
              onKeyDown={handleContentKeyDown}
              onScroll={(event) => {
                if (searchHighlightVisible && searchMatch?.field === "content") {
                  setLineHighlight(positionMemoSearchLine(event.currentTarget, content, searchMatch, false));
                }
              }}
            />
          </div>
          {images.length > 0 && (
            <div className="memo-image-list" aria-label="已插入图片">
              {images.map((image, index) => (
                <figure key={image.path}>
                  <button
                    type="button"
                    className="memo-image-thumbnail"
                    aria-label={`查看图片 ${image.name}`}
                    onClick={() => setPreviewImageIndex(index)}
                  >
                    {imageUrls[image.path]
                      ? <img src={imageUrls[image.path]} alt="" />
                      : <span className="memo-image-loading"><ImageIcon size={22} />加载中</span>}
                  </button>
                  <figcaption title={image.name}>{image.name}</figcaption>
                  <button type="button" className="icon-button" aria-label={`移除图片 ${image.name}`} onClick={() => removeImageFromDraft(image)}><X size={15} /></button>
                </figure>
              ))}
            </div>
          )}
          <p className="form-hint memo-image-hint">最多 {MEMO_IMAGE_LIMIT} 张，单张不超过 8 MB；图片保存到账号私有空间并随备忘录同步。</p>
        </div>
        {message && <p className="auth-message error">{message}</p>}
        <div className="memo-dialog-actions">
          <button type="button" className="button secondary memo-cancel-button" onClick={onClose}>取消</button>
          <button type="button" className="button secondary" onClick={() => void copyFullText()}><Copy size={16} />复制全文</button>
          <button className="button primary" disabled={uploadingImages}>{uploadingImages ? "图片上传中" : "保存备忘录"}</button>
          {memo && <button type="button" className="button danger-button" disabled={uploadingImages} onClick={() => void remove()}>删除备忘录</button>}
        </div>
      </form>
      {previewImageIndex !== null && images[previewImageIndex] && (
        <MemoImagePreview
          images={images}
          initialIndex={previewImageIndex}
          onClose={() => setPreviewImageIndex(null)}
        />
      )}
    </Modal>
  );
}

function memoChecklistMarkerAtPoint(
  textarea: HTMLTextAreaElement,
  content: string,
  clientX: number,
  clientY: number
): number | null {
  const ranges = getMemoChecklistMarkerRanges(content);
  if (!ranges.length) return null;

  const textareaRect = textarea.getBoundingClientRect();
  if (textareaRect.width <= 0 || textareaRect.height <= 0) {
    const caret = textarea.selectionStart;
    return ranges.find((range) => range.cursor === caret)?.cursor ?? null;
  }

  const computed = window.getComputedStyle(textarea);
  const borderLeft = Number.parseFloat(computed.borderLeftWidth) || textarea.clientLeft || 0;
  const borderTop = Number.parseFloat(computed.borderTopWidth) || textarea.clientTop || 0;
  const borderRight = Number.parseFloat(computed.borderRightWidth) || borderLeft;
  const borderBottom = Number.parseFloat(computed.borderBottomWidth) || borderTop;
  const viewportWidth = textarea.clientWidth || Math.max(1, textareaRect.width - borderLeft - borderRight);
  const viewportHeight = textarea.clientHeight || Math.max(1, textareaRect.height - borderTop - borderBottom);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.dataset.memoChecklistHitMirror = "true";
  Object.assign(mirror.style, {
    position: "fixed",
    zIndex: "-1",
    left: `${textareaRect.left + borderLeft}px`,
    top: `${textareaRect.top + borderTop}px`,
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
    boxSizing: "border-box",
    width: `${viewportWidth}px`,
    height: `${viewportHeight}px`,
    margin: "0",
    border: "0",
    padding: computed.padding,
    font: computed.font,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    fontVariant: computed.fontVariant,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    textAlign: computed.textAlign,
    textIndent: computed.textIndent,
    textTransform: computed.textTransform,
    direction: computed.direction,
    tabSize: computed.tabSize,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: computed.wordBreak,
    userSelect: "none"
  });

  const markers: Array<{ cursor: number; element: HTMLSpanElement }> = [];
  let offset = 0;
  for (const range of ranges) {
    mirror.append(document.createTextNode(content.slice(offset, range.start)));
    const marker = document.createElement("span");
    marker.dataset.memoMarkerCursor = String(range.cursor);
    marker.textContent = content.slice(range.start, range.end);
    mirror.append(marker);
    markers.push({ cursor: range.cursor, element: marker });
    offset = range.end;
  }
  mirror.append(document.createTextNode(`${content.slice(offset)}\u200b`));
  document.body.append(mirror);
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;

  try {
    for (const marker of markers) {
      const rects = Array.from(marker.element.getClientRects());
      if (!rects.length) rects.push(marker.element.getBoundingClientRect());
      if (rects.some((rect) => (
        rect.width > 0
        && rect.height > 0
        && clientX >= rect.left
        && clientX < rect.right
        && clientY >= rect.top
        && clientY < rect.bottom
      ))) return marker.cursor;
    }
    return null;
  } finally {
    mirror.remove();
  }
}

function positionMemoSearchLine(
  textarea: HTMLTextAreaElement,
  content: string,
  match: SearchNavigationMatch,
  center = true
): { top: number; height: number } {
  const computed = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 23;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 9;
  let contentTop = paddingTop + match.line * lineHeight;
  let contentHeight = lineHeight;
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(computed.borderRightWidth) || 0;
  const viewportWidth = textarea.clientWidth || textarea.offsetWidth || Number.parseFloat(computed.width) || 600;
  const fallbackBorders = textarea.clientWidth ? 0 : borderLeft + borderRight;
  const contentWidth = Math.max(1, viewportWidth - paddingLeft - paddingRight - fallbackBorders);
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    boxSizing: "content-box",
    width: `${contentWidth}px`,
    padding: computed.padding,
    border: "0",
    font: computed.font,
    letterSpacing: computed.letterSpacing,
    lineHeight: computed.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: computed.wordBreak
  });
  mirror.append(document.createTextNode(content.slice(0, match.lineStart)));
  const marker = document.createElement("span");
  marker.textContent = content.slice(match.lineStart, match.lineEnd) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  if (markerRect.height > 0) {
    contentTop = markerRect.top - mirrorRect.top;
    contentHeight = Math.max(lineHeight, markerRect.height);
  }
  mirror.remove();

  if (center) {
    const viewportHeight = textarea.clientHeight || 260;
    textarea.scrollTop = Math.max(0, contentTop - (viewportHeight - contentHeight) / 2);
  }
  return {
    top: Math.max(1, contentTop - textarea.scrollTop),
    height: Math.max(lineHeight, contentHeight)
  };
}

function copyTextFallback(content: string) {
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
