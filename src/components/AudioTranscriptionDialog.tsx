import { ArrowDown, ArrowUp, Copy, Download, FileAudio, KeyRound, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ClipboardEvent as ReactClipboardEvent } from "react";
import { cancelAiTask, getAiTaskSnapshot, retryAiTask, setAiTaskDialogOpen, startAiTask, subscribeAiTasks, updateAiTaskProgress } from "../lib/aiBackgroundTasks";
import { askAboutAudioTranscript, MAX_AUDIO_FILES, transcribeAudioFiles, validateAudioFile, type AudioConversationMessage, type AudioLanguage, type AudioTranscriptionResult } from "../lib/audioTranscription";
import { extractClipboardFiles } from "../lib/clipboardFiles";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";

interface AudioTranscriptionDialogProps {
  ownerId: string;
  onClose: () => void;
}

export function AudioTranscriptionDialog({ ownerId, onClose }: AudioTranscriptionDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<AudioLanguage>("auto");
  const [summarize, setSummarize] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [progress, setProgress] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AudioTranscriptionResult | null>(() => loadLatestResult(ownerId));
  const task = useSyncExternalStore(subscribeAiTasks, () => getAiTaskSnapshot("audio_transcription"), () => getAiTaskSnapshot("audio_transcription"));
  const loading = task.status === "running";

  useEffect(() => {
    setResult(loadLatestResult(ownerId));
  }, [ownerId]);

  useEffect(() => {
    setAiTaskDialogOpen("audio_transcription", true);
    return () => setAiTaskDialogOpen("audio_transcription", false);
  }, []);

  function addFiles(fileList: FileList | readonly File[] | null, source: "picker" | "paste" = "picker") {
    if (!fileList?.length) return;
    try {
      const incoming = Array.from(fileList);
      incoming.forEach(validateAudioFile);
      setFiles((current) => {
        const next = [...current];
        incoming.forEach((file) => {
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (!next.some((item) => `${item.name}:${item.size}:${item.lastModified}` === key)) next.push(file);
        });
        if (next.length > MAX_AUDIO_FILES) showToast(`一次最多选择 ${MAX_AUDIO_FILES} 个音频文件。`, "error");
        return next.slice(0, MAX_AUDIO_FILES);
      });
      if (source === "paste") showToast(`已粘贴 ${incoming.length} 个音频文件。`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "读取音频失败。", "error");
    }
  }

  function pasteAudioFiles(event: ReactClipboardEvent<HTMLElement>) {
    const pastedFiles = extractClipboardFiles(event.clipboardData);
    if (!pastedFiles.length) return;
    event.preventDefault();
    if (loading) {
      showToast("当前正在处理音频，请稍后再粘贴文件。", "error");
      return;
    }
    addFiles(pastedFiles, "paste");
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function reportProgress(message: string, percent?: number) {
    setProgress(message);
    if (typeof percent === "number") setUploadPercent(percent);
    updateAiTaskProgress("audio_transcription", message);
  }

  function runTranscription() {
    if (!files.length || loading) return;
    const selectedFiles = [...files];
    setProgress("准备上传音频…");
    setUploadPercent(0);
    const started = startAiTask({
      feature: "audio_transcription",
      label: `正在转写 ${selectedFiles.length} 个音频`,
      successMessage: "音频转写已完成，点击可查看和继续提问。",
      run: (signal) => {
        updateAiTaskProgress("audio_transcription", "准备上传音频…");
        return transcribeAudioFiles({
          files: selectedFiles,
          language,
          summarize,
          accessCode,
          signal,
          onProgress: (completed, total, step) => {
            if (step === "转写中") {
              const safeTotal = Math.max(1, total);
              const display = Math.min(safeTotal, Math.max(1, completed));
              const percent = Math.round((display / safeTotal) * 100);
              reportProgress(`正在转写 ${display}/${safeTotal} 段`, percent);
            } else if (step === "整理结果") {
              reportProgress(total > 1 ? `分段转写完成（${total}/${total}），正在整理结果…` : "正在整理结果…", 100);
            } else {
              // Upload phase: completed is finished count (0..total), show next file as completed+1.
              const currentFile = Math.min(total, Math.max(1, completed + 1));
              reportProgress(`正在上传 ${currentFile}/${total}：${step}`, 0);
            }
          },
          onUploadProgress: (percent, fileName) => {
            reportProgress(`正在上传：${fileName}（${percent}%）`, percent);
          }
        });
      },
      onSuccess: (next) => {
        saveLatestResult(ownerId, next);
        setResult(next);
        setProgress("");
        setUploadPercent(0);
        if (next.access === "access-code") setAccessCode("");
        if (next.warning) showToast(next.warning, "info", 8000);
      },
      onError: () => {
        setProgress("");
        setUploadPercent(0);
        // If a previous partial success was saved mid-run, keep showing it.
        setResult(loadLatestResult(ownerId));
      }
    });
    if (!started) {
      setProgress("");
      showToast("已有音频任务正在处理。", "error");
    }
  }

  function askQuestion() {
    const trimmed = question.trim();
    if (!result || !trimmed || loading) return;
    const userMessage: AudioConversationMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed };
    const baseConversation = [...(result.conversation ?? []), userMessage];
    const pendingResult = { ...result, conversation: baseConversation };
    setResult(pendingResult);
    saveLatestResult(ownerId, pendingResult);
    setQuestion("");
    startAiTask({
      feature: "audio_transcription",
      label: "正在回答音频内容问题",
      successMessage: "音频内容问题已回答，点击可查看。",
      run: (signal) => askAboutAudioTranscript({ transcript: result.transcript, question: trimmed, history: result.conversation, accessCode, signal }),
      onSuccess: (response) => {
        const next = {
          ...pendingResult,
          conversation: [...baseConversation, { id: `a-${Date.now()}`, role: "assistant" as const, content: response.answer }]
        };
        saveLatestResult(ownerId, next);
        setResult(next);
        if (response.access === "access-code") setAccessCode("");
      }
    });
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
    anchor.download = `${safeFileName(result.files?.[0]?.replace(/\.(mp3|wav)$/i, "") || "音频")}-转写.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function clearHistory() {
    if (!window.confirm("确定清除当前设备上的转写结果、摘要和问答记录吗？此操作无法恢复。")) return;
    localStorage.removeItem(storageKey(ownerId));
    setResult(null);
    setQuestion("");
    showToast("转写历史记录已清除。", "success");
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
      <div className="audio-transcription-dialog" onPaste={pasteAudioFiles}>
        <section className="audio-transcription-controls">
          <label className="audio-file-field">
            <span>音频文件</span>
            <input type="file" multiple accept=".mp3,.wav,.flac,.m4a,.ogg,audio/mpeg,audio/mp3,audio/wav,audio/flac,audio/mp4,audio/ogg" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          </label>
          <p className="attachment-paste-hint">电脑端可按 Ctrl+V 粘贴浏览器提供的音频文件</p>
          {files.length > 0 && (
            <ol className="audio-file-list" aria-label="待转写音频顺序">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span><strong>{index + 1}. {file.name}</strong><small>{formatFileSize(file.size)}</small></span>
                  <button type="button" className="icon-button" aria-label={`上移 ${file.name}`} disabled={index === 0 || loading} onClick={() => moveFile(index, -1)}><ArrowUp size={14} /></button>
                  <button type="button" className="icon-button" aria-label={`下移 ${file.name}`} disabled={index === files.length - 1 || loading} onClick={() => moveFile(index, 1)}><ArrowDown size={14} /></button>
                  <button type="button" className="icon-button" aria-label={`移除 ${file.name}`} disabled={loading} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
                </li>
              ))}
            </ol>
          )}
          <label>识别语言
            <select value={language} onChange={(event) => setLanguage(event.target.value as AudioLanguage)}>
              <option value="auto">自动识别</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="checkbox-label"><input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} />转写后生成摘要</label>
          {loading ? (
            <button type="button" className="button danger-button" onClick={() => { if (cancelAiTask("audio_transcription")) { setProgress(""); setUploadPercent(0); showToast("已取消当前音频处理。", "success"); } }}>
              <X size={16} />取消处理
            </button>
          ) : (
            <button type="button" className="button primary" disabled={!files.length} onClick={runTranscription}>
              <Sparkles size={16} />{`开始转写${files.length > 1 ? `（${files.length} 段）` : ""}`}
            </button>
          )}
          {loading && (
            <div className="audio-transcription-progress" role="status" aria-live="polite">
              <strong>{progress || task.message || "处理中…"}</strong>
              <div className="audio-transcription-progress-bar" aria-hidden="true">
                <span style={{
                  width: `${
                    progress.includes("整理")
                      ? 100
                      : uploadPercent > 0
                        ? uploadPercent
                        : progress.includes("转写")
                          ? Math.max(8, uploadPercent)
                          : 12
                  }%`
                }} />
              </div>
              {uploadPercent > 0 && uploadPercent < 100 && (
                <small>{progress.includes("转写") ? `分段进度约 ${uploadPercent}%` : `当前文件 ${uploadPercent}%`}</small>
              )}
            </div>
          )}
          {task.status === "error" && <div className="ai-inline-error" role="alert"><span>{task.message}</span><button type="button" className="button secondary compact" onClick={() => retryAiTask("audio_transcription")}>重试</button></div>}
          <p className="muted-note">支持 MP3、WAV、FLAC、M4A、OGG，单个源文件不超过 100 MB，最多 {MAX_AUDIO_FILES} 个。超过 7 MB 的 M4A/OGG/FLAC 会在浏览器（含安卓 App 内置页面）转成 16kHz 单声道语音 WAV，并按录音时间顺序自动切段上传。多个文件按列表从上到下的顺序拼接（可用上下箭头调整）。中间某段网络失败会跳过并继续后面的段，结果里会标注失败段。上传的临时音频约 7 天后自动清理。转写结果仅保存在本机，不会在账号间云同步。</p>
          <p className="muted-note" style={{ color: "#b45309" }}>⚠ 音频转写对网络稳定性要求较高，大文件上传可能需要几分钟。建议在 Wi-Fi 或信号良好的环境下使用，上传期间请勿切换网络。</p>
        </section>

        <section className="audio-transcription-result">
          {result ? (
            <>
              <header>
                <div><FileAudio size={19} /><strong>转写结果</strong></div>
                <div className="inline-actions">
                  <button type="button" className="button danger-button compact" onClick={clearHistory}><Trash2 size={15} />清除记录</button>
                  <button type="button" className="icon-button" aria-label="复制完整转写" title="复制完整转写" onClick={() => void copyText(result.transcript)}><Copy size={16} /></button>
                  <button type="button" className="button secondary compact" onClick={downloadResult}><Download size={15} />TXT</button>
                </div>
              </header>
              {result.warning && <p className="status-message">{result.warning}</p>}
              {result.summary && <article><div><strong>摘要</strong><button type="button" className="icon-button" aria-label="复制摘要" onClick={() => void copyText(result.summary ?? "")}><Copy size={15} /></button></div><p>{result.summary}</p></article>}
              <article><strong>完整转写</strong><p>{result.transcript}</p></article>
              <section className="audio-followup" aria-label="音频内容问答">
                <header><strong>继续询问录音细节</strong><span>回答只依据当前转写内容</span></header>
                {(result.conversation ?? []).map((message) => <p key={message.id} className={message.role}><strong>{message.role === "user" ? "你" : "AI"}</strong>{message.content}</p>)}
                <form onSubmit={(event) => { event.preventDefault(); askQuestion(); }}>
                  <input value={question} disabled={loading} placeholder="例如：谁负责下一步？具体截止时间是什么？" onChange={(event) => setQuestion(event.target.value)} />
                  <button type="submit" className="button primary compact" disabled={loading || !question.trim()}><Send size={15} />发送</button>
                </form>
              </section>
            </>
          ) : (
            <div className="audio-transcription-empty"><FileAudio size={42} /><strong>选择音频开始转写</strong><span>可按顺序导入会议上半场、下半场，再统一整理和提问。</span></div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function storageKey(ownerId: string): string {
  return `semester-schedule-audio-transcription:${ownerId}`;
}

function saveLatestResult(ownerId: string, result: AudioTranscriptionResult) {
  localStorage.setItem(storageKey(ownerId), JSON.stringify(result));
}

function loadLatestResult(ownerId: string): AudioTranscriptionResult | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(ownerId)) ?? "null") as AudioTranscriptionResult | null;
    return value?.transcript ? value : null;
  } catch {
    return null;
  }
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "音频";
}
