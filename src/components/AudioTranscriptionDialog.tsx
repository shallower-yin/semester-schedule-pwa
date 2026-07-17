import { Copy, Download, FileAudio, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { transcribeAudio, type AudioLanguage, type AudioTranscriptionResult } from "../lib/audioTranscription";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";

interface AudioTranscriptionDialogProps {
  ownerId: string;
  onClose: () => void;
}

export function AudioTranscriptionDialog({ ownerId, onClose }: AudioTranscriptionDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<AudioLanguage>("auto");
  const [summarize, setSummarize] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AudioTranscriptionResult | null>(() => loadLatestResult(ownerId));

  useEffect(() => {
    setResult(loadLatestResult(ownerId));
  }, [ownerId]);

  async function runTranscription() {
    if (!file || loading) return;
    setLoading(true);
    try {
      const next = await transcribeAudio({ file, language, summarize, accessCode });
      setResult(next);
      localStorage.setItem(storageKey(ownerId), JSON.stringify(next));
      if (next.access === "access-code") setAccessCode("");
      showToast(next.warning || "音频转写完成。", next.warning ? "error" : "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "音频转写失败。", "error");
    } finally {
      setLoading(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast("已复制。", "success");
    } catch {
      showToast("复制失败，请手动选择文字。", "error");
    }
  }

  function downloadResult() {
    if (!result) return;
    const content = result.summary
      ? `音频摘要\n\n${result.summary}\n\n完整转写\n\n${result.transcript}`
      : result.transcript;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(file?.name.replace(/\.(mp3|wav)$/i, "") || "音频")}-转写.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Modal
      title="AI 音频转写"
      onClose={onClose}
      wide
      className="audio-transcription-modal"
      headerExtra={(
        <label className="ai-header-access-code">
          <KeyRound size={14} />
          <input value={accessCode} placeholder="访问口令" aria-label="音频转写访问口令" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
      )}
    >
      <div className="audio-transcription-dialog">
        <section className="audio-transcription-controls">
          <label className="audio-file-field">
            <span>音频文件</span>
            <input type="file" accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label>识别语言
            <select value={language} onChange={(event) => setLanguage(event.target.value as AudioLanguage)}>
              <option value="auto">自动识别</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="checkbox-label"><input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} />转写后生成摘要</label>
          <button type="button" className="button primary" disabled={!file || loading} onClick={() => void runTranscription()}>
            <Sparkles size={16} />{loading ? "处理中…" : "开始转写"}
          </button>
          <p className="muted-note">支持 MP3、WAV，单个文件不超过 7 MB。音频会发送至 MiMo 接口处理，但不保存到应用数据库或 Storage。</p>
        </section>

        <section className="audio-transcription-result">
          {result ? (
            <>
              <header>
                <div><FileAudio size={19} /><strong>转写结果</strong></div>
                <div className="inline-actions">
                  <button type="button" className="icon-button" aria-label="复制完整转写" title="复制完整转写" onClick={() => void copyText(result.transcript)}><Copy size={16} /></button>
                  <button type="button" className="button secondary compact" onClick={downloadResult}><Download size={15} />TXT</button>
                </div>
              </header>
              {result.warning && <p className="status-message">{result.warning}</p>}
              {result.summary && <article><div><strong>摘要</strong><button type="button" className="icon-button" aria-label="复制摘要" onClick={() => void copyText(result.summary ?? "")}><Copy size={15} /></button></div><p>{result.summary}</p></article>}
              <article><strong>完整转写</strong><p>{result.transcript}</p></article>
            </>
          ) : (
            <div className="audio-transcription-empty"><FileAudio size={42} /><strong>选择音频开始转写</strong><span>可只转文字，也可以同时整理摘要和待办。</span></div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function storageKey(ownerId: string): string {
  return `semester-schedule-audio-transcription:${ownerId}`;
}

function loadLatestResult(ownerId: string): AudioTranscriptionResult | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(ownerId)) ?? "null") as AudioTranscriptionResult | null;
    return value?.transcript ? value : null;
  } catch {
    return null;
  }
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "音频";
}
