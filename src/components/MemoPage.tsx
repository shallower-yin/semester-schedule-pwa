import { useLiveQuery } from "dexie-react-hooks";
import { FileText, Folder, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { db, queueChange } from "../db";
import { syncFields } from "../lib/identity";
import type { Memo, MemoFolder } from "../types";
import { Modal } from "./Modal";

interface MemoPageProps {
  ownerId: string;
}

type FolderFilter = "all" | "trash" | string;

export function MemoPage({ ownerId }: MemoPageProps) {
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
  const [memoToEdit, setMemoToEdit] = useState<Memo | null | undefined>(undefined);

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
    setFilter(folder.id);
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
    setFilter("all");
  }

  async function restoreMemo(memo: Memo) {
    const restored = { ...memo, ...syncFields(memo), deleted_at: null };
    await db.memos.put(restored);
    await queueChange("memos", restored.id);
  }

  return (
    <section className="memo-page">
      <aside className="memo-sidebar">
        <div className="memo-search">
          <Search size={17} />
          <input placeholder="搜索备忘录" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="memo-sidebar-section">
          <span>展示列表</span>
          <div className="memo-view-toggle">
            <button disabled>视图</button>
            <button className="active">列表</button>
            <button disabled>九宫格</button>
          </div>
        </div>
        <div className="memo-sidebar-section">
          <div className="memo-sidebar-title">
            <span>文件夹</span>
            <button className="text-button" onClick={() => void addFolder()}><Plus size={14} />添加</button>
          </div>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            <FileText size={18} /><span>全部</span><small>{activeMemoCount}</small>
          </button>
          {folders.map((folder) => (
            <button key={folder.id} className={filter === folder.id ? "active" : ""} onClick={() => setFilter(folder.id)}>
              <Folder size={18} /><span>{folder.name}</span>
              <small>{memos.filter((memo) => !memo.deleted_at && memo.folder_id === folder.id).length}</small>
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
          <button className={filter === "trash" ? "active" : ""} onClick={() => setFilter("trash")}>
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
          <button className="button primary compact" onClick={() => setMemoToEdit(null)}><Plus size={17} />新增备忘录</button>
        </div>
        {visibleMemos.length ? (
          <div className="memo-list">
            {visibleMemos.map((memo) => (
              <article className="memo-card" key={memo.id} onClick={() => !memo.deleted_at && setMemoToEdit(memo)}>
                <time>{memo.updated_at.slice(0, 10).replaceAll("-", "/")}</time>
                <h2>{memo.title}</h2>
                <p>{memo.content || "无正文"}</p>
                {memo.deleted_at ? (
                  <button
                    className="button secondary compact"
                    onClick={(event) => {
                      event.stopPropagation();
                      void restoreMemo(memo);
                    }}
                  >
                    <RotateCcw size={15} />恢复
                  </button>
                ) : null}
              </article>
            ))}
          </div>
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
        <label>正文<textarea className="memo-textarea" rows={12} value={content} onChange={(event) => setContent(event.target.value)} /></label>
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
