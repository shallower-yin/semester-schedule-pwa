import { FileAudio2, Music2, Trash2, Upload, Waves, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  deleteFocusAudioTrack,
  formatAudioFileSize,
  isSupportedFocusAudioFile,
  listFocusAudioTracks,
  setFocusAudioEnabled,
  setFocusAudioKind,
  uploadFocusAudioTrack,
  type FocusAudioKind,
  type FocusAudioTrack
} from "../lib/focusAudio";

interface AudioUploadDraft {
  id: string;
  file: File;
  title: string;
  status: "pending" | "uploading" | "error";
  error?: string;
}

export function AdminFocusAudioManager() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState<FocusAudioTrack[]>([]);
  const [kind, setKind] = useState<FocusAudioKind>("white_noise");
  const [drafts, setDrafts] = useState<AudioUploadDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      setTracks(await listFocusAudioTracks(true));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音频列表读取失败。");
    }
  }

  useEffect(() => { void refresh(); }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length || busy) return;
    const files = Array.from(fileList);
    const audioFiles = files.filter(isSupportedFocusAudioFile);
    setDrafts((current) => [
      ...current,
      ...audioFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        title: titleFromFileName(file.name),
        status: "pending" as const
      }))
    ]);
    if (files.length !== audioFiles.length) setMessage(`已忽略 ${files.length - audioFiles.length} 个非音频文件。`);
    else setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function updateDraft(id: string, patch: Partial<AudioUploadDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  async function uploadTracks() {
    if (!drafts.length || busy) return;
    const missingTitles = drafts.filter((draft) => !draft.title.trim());
    if (missingTitles.length) {
      setDrafts((current) => current.map((draft) => !draft.title.trim() ? { ...draft, status: "error", error: "请填写名称" } : draft));
      setMessage(`还有 ${missingTitles.length} 个音频没有名称。`);
      return;
    }
    setBusy(true);
    setMessage("");
    const queue = [...drafts];
    const uploadedIds = new Set<string>();
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const draft = queue[cursor++];
        updateDraft(draft.id, { status: "uploading", error: undefined });
        try {
          await uploadFocusAudioTrack({ file: draft.file, title: draft.title, kind });
          uploadedIds.add(draft.id);
        } catch (error) {
          updateDraft(draft.id, {
            status: "error",
            error: error instanceof Error ? error.message : "上传失败"
          });
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
      const failedCount = queue.length - uploadedIds.size;
      setDrafts((current) => current.filter((draft) => !uploadedIds.has(draft.id)));
      setMessage(failedCount
        ? `已上传 ${uploadedIds.size} 个，${failedCount} 个失败，请检查后重试。`
        : `已上传并发布 ${uploadedIds.size} 个音频。`);
      if (uploadedIds.size) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTrack(track: FocusAudioTrack) {
    setBusy(true);
    try {
      await setFocusAudioEnabled(track.id, !track.is_enabled);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音频状态更新失败。");
    } finally {
      setBusy(false);
    }
  }

  async function changeTrackKind(track: FocusAudioTrack, nextKind: FocusAudioKind) {
    if (nextKind === track.kind || busy) return;
    setBusy(true);
    try {
      await setFocusAudioKind(track.id, nextKind);
      setMessage(`“${track.title}”已改为${nextKind === "white_noise" ? "白噪音" : "音乐"}。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音频分类更新失败。");
    } finally {
      setBusy(false);
    }
  }

  async function removeTrack(track: FocusAudioTrack) {
    if (!window.confirm(`彻底删除音频“${track.title}”？文件也会从 Storage 删除。`)) return;
    setBusy(true);
    try {
      await deleteFocusAudioTrack(track);
      setMessage("音频及 Storage 文件已删除。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音频删除失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-access-editor admin-focus-audio">
      <div className="section-heading"><div><h3><Waves size={18} /> 专注音频</h3><p>文件保存在 Supabase Storage，数据库仅保存名称、分类和文件路径。</p></div></div>
      <div className="admin-audio-upload">
        <label>分类<select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as FocusAudioKind)}><option value="white_noise">白噪音</option><option value="music">音乐</option></select></label>
        <label>音频文件（可多选）<input ref={inputRef} type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,audio/x-m4a,.mp3,.m4a,.mp4,.ogg,.oga,.wav,.webm" multiple disabled={busy} onChange={(event) => addFiles(event.target.files)} /></label>
        <button className="button primary" disabled={busy || !drafts.length} onClick={() => void uploadTracks()}><Upload size={16} />{busy ? "批量上传中" : drafts.length ? `上传 ${drafts.length} 个并发布` : "选择后上传"}</button>
      </div>
      {drafts.length > 0 && <div className="admin-audio-upload-queue">
        <header><strong>待上传 {drafts.length} 个</strong><button className="button secondary compact" disabled={busy} onClick={() => setDrafts([])}>清空</button></header>
        <div>
          {drafts.map((draft) => <article key={draft.id} className={draft.status === "error" ? "error" : ""}>
            <FileAudio2 size={18} />
            <span><strong>{draft.file.name}</strong><small>{formatAudioFileSize(draft.file.size)}{draft.status === "uploading" ? " · 上传中" : draft.error ? ` · ${draft.error}` : ""}</small></span>
            <label>名称<input aria-label={`${draft.file.name} 的名称`} value={draft.title} disabled={busy} onChange={(event) => updateDraft(draft.id, { title: event.target.value, status: "pending", error: undefined })} /></label>
            <button className="icon-button" aria-label={`移除${draft.file.name}`} disabled={busy} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><X size={15} /></button>
          </article>)}
        </div>
      </div>}
      <div className="admin-audio-list">
        {tracks.map((track) => <article key={track.id}>
          <span className="admin-audio-kind">{track.kind === "white_noise" ? <Waves size={16} /> : <Music2 size={16} />}</span>
          <span><strong>{track.title}</strong><small>{formatAudioFileSize(track.file_size)} · {track.is_enabled ? "使用中" : "已停用"}</small></span>
          <select className="admin-audio-category-select" aria-label={`${track.title} 的分类`} value={track.kind} disabled={busy} onChange={(event) => void changeTrackKind(track, event.target.value as FocusAudioKind)}>
            <option value="white_noise">白噪音</option>
            <option value="music">音乐</option>
          </select>
          <button className="button secondary compact" disabled={busy} onClick={() => void toggleTrack(track)}>{track.is_enabled ? "停用" : "启用"}</button>
          <button className="icon-button danger" aria-label={`删除${track.title}`} disabled={busy} onClick={() => void removeTrack(track)}><Trash2 size={16} /></button>
        </article>)}
        {!tracks.length && <p className="muted-note">还没有上传音频。</p>}
      </div>
      {message && <p className="status-message">{message}</p>}
    </section>
  );
}

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "未命名音频";
}
