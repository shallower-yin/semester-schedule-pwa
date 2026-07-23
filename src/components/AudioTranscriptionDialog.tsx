import { ArrowDown, ArrowUp, Copy, Download, FileAudio, KeyRound, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ClipboardEvent as ReactClipboardEvent } from "react";
import { cancelAiTask, getAiTaskSnapshot, retryAiTask, setAiTaskDialogOpen, startAiTask, subscribeAiTasks, updateAiTaskProgress } from "../lib/aiBackgroundTasks";
import { askAboutAudioTranscript, MAX_AUDIO_FILES, transcribeAudioFiles, validateAudioFile, type AudioConversationMessage, type AudioLanguage, type AudioTranscriptionResult } from "../lib/audioTranscription";
import { extractClipboardFiles } from "../lib/clipboardFiles";
import { exportText } from "../lib/fileExport";
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
            if (step.includes("已成功") || step.includes("正在转写") || step.includes("补救") || step.includes("整理摘要")) {
              const safeTotal = Math.max(1, total);
              const percent = Math.round((Math.min(safeTotal, Math.max(0, completed)) / safeTotal) * 100);
              // Prefer the detailed step string from progressive ASR (includes 已成功 n/N).
              reportProgress(step.startsWith("正在") || step.startsWith("补救") || step.startsWith("整理")
                ? step
                : `正在转写 ${completed}/${safeTotal} 段`, percent);
            } else if (step === "转写中") {
              const safeTotal = Math.max(1, total);
              const display = Math.min(safeTotal, Math.max(1, completed));
              const percent = Math.round((display / safeTotal) * 100);
              reportProgress(
                safeTotal > 1 ? `正在转写 ${display}/${safeTotal} 段` : "正在转写（单段文件）",
                percent
              );
            } else if (step === "整理结果") {
              reportProgress(total > 1 ? `分段转写完成（${total}/${total}），正在整理结果…` : "正在整理结果…", 100);
            } else if (step.includes("转换分段") || step.includes("解析分段") || step.includes("按音频时间") || step.includes("转为")) {
              reportProgress(step, typeof completed === "number" && total > 0 ? Math.round((completed / total) * 100) : 0);
            } else {
              const currentFile = Math.min(total, Math.max(1, completed + 1));
              reportProgress(`正在上传 ${currentFile}/${total}：${step}`, 0);
            }
          },
          onUploadProgress: (percent, fileName) => {
            reportProgress(`正在上传：${fileName}（${percent}%）`, percent);
          },
          onPartialResult: (partial) => {
            // Checkpoint every finished segment so a later network drop never wipes paid work.
            saveLatestResult(ownerId, partial);
            setResult(partial);
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
        else showToast("转写完成，正文已保存。", "success");
      },
      onError: (error) => {
        setProgress("");
        setUploadPercent(0);
        // Prefer checkpointed partial transcript over a blank error screen.
        const partial = loadLatestResult(ownerId);
        if (partial?.transcript?.trim()) {
          setResult({
            ...partial,
            warning: [
              partial.warning,
              error instanceof Error ? `任务中断：${error.message}` : "任务中断，已尽量保留已完成正文。"
            ].filter(Boolean).join(" ")
          });
          showToast("连接中断，已尽量保留已完成的转写正文。", "info", 8000);
          return;
        }
        setResult(partial);
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

  async function downloadResult() {
    if (!result) return;
    const content = result.summary
      ? `音频摘要\n\n${result.summary}\n\n完整转写\n\n${result.transcript}`
      : result.transcript;
    try {
      const exported = await exportText(
        content,
        `${safeFileName(result.files?.[0]?.replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, "") || "音频")}-转写.txt`
      );
      if (exported.saved) showToast("转写 TXT 已保存。", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存 TXT 失败。", "error");
    }
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
          <p className="muted-note">支持 MP3、WAV、FLAC、M4A、OGG，单个源文件不超过 100 MB，最多 {MAX_AUDIO_FILES} 个。长 M4A 直接按 AAC 音频帧和真实时长切段，不再在手机中整段解码；长 MP3 按帧渐进转写。多个文件严格按列表顺序、再按各自分段序号拼接（可用上下箭头调整）。中间某段失败会保留原位置并只补救缺口。临时音频在成功、取消或终止失败后主动清理，存储生命周期仅作兜底。转写结果保存在当前设备。</p>
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
                  <button type="button" className="button secondary compact" onClick={() => void downloadResult()}><Download size={15} />TXT</button>
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
