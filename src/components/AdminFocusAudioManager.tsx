import { Music2, Trash2, Upload, Waves } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  deleteFocusAudioTrack,
  formatAudioFileSize,
  listFocusAudioTracks,
  setFocusAudioEnabled,
  uploadFocusAudioTrack,
  type FocusAudioKind,
  type FocusAudioTrack
} from "../lib/focusAudio";

export function AdminFocusAudioManager() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState<FocusAudioTrack[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<FocusAudioKind>("white_noise");
  const [file, setFile] = useState<File | null>(null);
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

  async function uploadTrack() {
    if (!file || !title.trim() || busy) {
      setMessage("请填写名称并选择音频文件。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await uploadFocusAudioTrack({ file, title, kind });
      setTitle("");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMessage("音频已上传并发布。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音频上传失败。");
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
        <label>分类<select value={kind} onChange={(event) => setKind(event.target.value as FocusAudioKind)}><option value="white_noise">白噪音</option><option value="music">音乐</option></select></label>
        <label>名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨声" /></label>
        <label>音频文件<input ref={inputRef} type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="button primary" disabled={busy} onClick={() => void uploadTrack()}><Upload size={16} />上传并发布</button>
      </div>
      <div className="admin-audio-list">
        {tracks.map((track) => <article key={track.id}>
          <span className="admin-audio-kind">{track.kind === "white_noise" ? <Waves size={16} /> : <Music2 size={16} />}</span>
          <span><strong>{track.title}</strong><small>{formatAudioFileSize(track.file_size)} · {track.is_enabled ? "使用中" : "已停用"}</small></span>
          <button className="button secondary compact" disabled={busy} onClick={() => void toggleTrack(track)}>{track.is_enabled ? "停用" : "启用"}</button>
          <button className="icon-button danger" aria-label={`删除${track.title}`} disabled={busy} onClick={() => void removeTrack(track)}><Trash2 size={16} /></button>
        </article>)}
        {!tracks.length && <p className="muted-note">还没有上传音频。</p>}
      </div>
      {message && <p className="status-message">{message}</p>}
    </section>
  );
}
