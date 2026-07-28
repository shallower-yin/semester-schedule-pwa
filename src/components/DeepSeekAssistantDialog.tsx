import { BrainCircuit, Clipboard, FileText, Image as ImageIcon, KeyRound, PencilLine, Send, Sparkles, Square, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent as ReactClipboardEvent } from "react";
import { db, queueChange } from "../db";
import { AI_DOCUMENT_ACCEPT, AI_IMAGE_ACCEPT, prepareAiAssistantAttachment, releaseAiAssistantAttachments, type AiAssistantAttachment } from "../lib/assistantAttachments";
import { cancelAiTask, getAiTaskSnapshot, setAiTaskDialogOpen, startAiTask, subscribeAiTasks } from "../lib/aiBackgroundTasks";
import { extractClipboardFiles } from "../lib/clipboardFiles";
import { askDeepSeekAssistant, buildDeepSeekScheduleContext, getAiAssistantConfiguration, type AiAssistantConfiguration, type DeepSeekAssistantAction, type DeepSeekAssistantHistoryMessage } from "../lib/deepSeekAssistant";
import { recordsFromAiActions, type AiCreatedRecord } from "../lib/aiEventActions";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { showToast } from "../lib/toast";
import { Modal } from "./Modal";
import { AttachmentSourcePicker } from "./AttachmentSourcePicker";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface DeepSeekAssistantDialogProps {
  input: ScheduleAssistantInput;
  ownerId: string;
  userEmail?: string | null;
  onClose: () => void;
}

const HISTORY_LIMIT = 30;
const CONTEXT_LIMIT = 10;
const ATTACHMENT_CONTEXT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QUICK_PROMPTS = ["看看我今天的安排", "检查本周时间冲突", "帮我规划这周重点", "这个应用怎么用"];

function aiAssistantHistoryKey(ownerId: string) {
  return `semester-schedule-ai-assistant-history:${ownerId}`;
}

export function DeepSeekAssistantDialog({ input, ownerId, onClose }: DeepSeekAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadAssistantHistory(ownerId));
  const [question, setQuestion] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [configuration, setConfiguration] = useState<AiAssistantConfiguration>({ provider: "deepseek", model: "deepseek-v4-flash", supportsAttachments: false });
  const [attachments, setAttachments] = useState<AiAssistantAttachment[]>([]);
  const [contextAttachments, setContextAttachments] = useState<AiAssistantAttachment[]>([]);
  const [preparingAttachment, setPreparingAttachment] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const editingRef = useRef<HTMLTextAreaElement | null>(null);
  const task = useSyncExternalStore(subscribeAiTasks, () => getAiTaskSnapshot("assistant"), () => getAiTaskSnapshot("assistant"));
  const loading = task.status === "running";

  useEffect(() => {
    setMessages(loadAssistantHistory(ownerId));
    setContextAttachments([]);
    setEditingMessageId(null);
    setEditingText("");
    let canceled = false;
    void loadAttachmentContext(ownerId).then((saved) => {
      if (!canceled) setContextAttachments(saved);
    });
    return () => {
      canceled = true;
    };
  }, [ownerId]);

  useEffect(() => {
    saveAssistantHistory(ownerId, messages);
  }, [messages, ownerId]);

  useEffect(() => {
    void getAiAssistantConfiguration().then(setConfiguration);
  }, []);

  useEffect(() => {
    setAiTaskDialogOpen("assistant", true);
    return () => setAiTaskDialogOpen("assistant", false);
  }, []);

  useEffect(() => {
    if (task.status === "success" || task.status === "error") setMessages(loadAssistantHistory(ownerId));
  }, [ownerId, task.status]);

  useEffect(() => {
    const messagesNode = messagesRef.current;
    if (!messagesNode) return;
    const frame = window.requestAnimationFrame(() => {
      if (typeof messagesNode.scrollTo === "function") messagesNode.scrollTo({ top: messagesNode.scrollHeight, behavior: "smooth" });
      else messagesNode.scrollTop = messagesNode.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, messages]);

  async function sendMessage(text: string, baseMessages: Message[], userMessageId: string, requestAttachments: AiAssistantAttachment[] = []) {
    const effectiveAttachments = mergeAttachments(contextAttachments, requestAttachments);
    const trimmed = text.trim() || (effectiveAttachments.length ? "请识别附件中的日程信息，并创建对应事项。" : "");
    if (!trimmed || loading) return;
    const history = messagesToHistory(baseMessages);
    // Build context with the current question so relative-time scopes such as “本周” and “明天”
    // actually constrain the records sent to the model.
    const requestContext = buildDeepSeekScheduleContext(input, trimmed);
    setQuestion("");
    const attachmentLabel = requestAttachments.length ? `\n附件：${requestAttachments.map((item) => item.name).join("、")}` : "";
    const messagesWithQuestion = [...baseMessages, { id: userMessageId, role: "user" as const, content: `${trimmed}${attachmentLabel}` }];
    setMessages(messagesWithQuestion);
    saveAssistantHistory(ownerId, messagesWithQuestion);
    setAttachments([]);
    if (effectiveAttachments.length) {
      setContextAttachments(effectiveAttachments);
      try {
        await saveAttachmentContext(ownerId, effectiveAttachments);
      } catch {
        showToast("附件可用于当前对话，但本地设备没有足够空间长期保留。", "error");
      }
    }
    const started = startAiTask({
      feature: "assistant",
      label: "AI 助手正在回答",
      successMessage: "AI 助手已回答，点击可查看当前对话。",
      run: async () => {
        const result = await askDeepSeekAssistant(trimmed, requestContext, accessCode.trim(), history, effectiveAttachments);
        const created = await createRecordsFromActions(result.actions ?? [], trimmed, ownerId);
        return {
          access: result.access,
          created,
          content: [result.answer, created.length ? createdSummary(created) : ""].filter(Boolean).join("\n"),
          processedAttachments: result.processedAttachments
        };
      },
      onSuccess: ({ access, created, content, processedAttachments }) => {
        const next = [...messagesWithQuestion, { id: `a-${Date.now()}`, role: "assistant" as const, content }];
        saveAssistantHistory(ownerId, next);
        setMessages(next);
        if (processedAttachments?.length) {
          const nextAttachments = replaceProcessedAttachments(effectiveAttachments, processedAttachments);
          setContextAttachments(nextAttachments);
          void saveAttachmentContext(ownerId, nextAttachments);
        }
        if (access === "access-code") setAccessCode("");
        if (created.length) showToast(createdSummary(created).replace(/\n/g, "；"), "success");
      },
      onError: (error) => {
        const next = [...messagesWithQuestion, {
          id: `e-${Date.now()}`,
          role: "assistant" as const,
          content: `暂时不能使用 AI 助手：${error.message}`
        }];
        saveAssistantHistory(ownerId, next);
        setMessages(next);
      }
    });
    if (!started) showToast("AI 助手正在处理上一条消息。", "error");
  }

  async function ask(text = question) {
    await sendMessage(text, messages, `u-${Date.now()}`, attachments);
  }

  async function addAttachments(files: FileList | readonly File[] | null, source: "picker" | "paste" = "picker") {
    if (!files?.length || !configuration.supportsAttachments) return;
    const incoming = Array.from(files);
    const available = Math.max(0, 3 - contextAttachments.length - attachments.length);
    if (available === 0) {
      if (source === "paste") showToast("最多保留 3 个附件，请先移除一个。", "error");
      return;
    }
    setPreparingAttachment(true);
    try {
      const prepared = await Promise.all(incoming.slice(0, available).map((file) => prepareAiAssistantAttachment(file, {
        accessCode,
        feature: "assistant",
        onProgress: (completed, total) => setAttachmentProgress(`上传 PDF ${completed}/${total} 页`)
      })));
      setAttachments((current) => [...current, ...prepared].slice(0, 3));
      if (source === "paste" && prepared.length) showToast(`已粘贴 ${prepared.length} 个附件。`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "读取附件失败。", "error");
    } finally {
      setPreparingAttachment(false);
      setAttachmentProgress("");
    }
  }

  function pasteAttachments(event: ReactClipboardEvent<HTMLElement>) {
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length || !configuration.supportsAttachments) return;
    event.preventDefault();
    if (loading || preparingAttachment || editingMessageId) {
      showToast("当前正在处理内容，请稍后再粘贴附件。", "error");
      return;
    }
    void addAttachments(files, "paste");
  }

  async function copyMessage(content: string) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(content);
      } else {
        copyTextFallback(content);
      }
      showToast("已复制。", "success");
    } catch {
      copyTextFallback(content);
      showToast("已复制。", "success");
    }
  }

  function editMessage(message: Message) {
    setEditingMessageId(message.id);
    setEditingText(message.content);
    window.setTimeout(() => {
      editingRef.current?.focus();
      editingRef.current?.setSelectionRange(editingRef.current.value.length, editingRef.current.value.length);
    }, 0);
  }

  function cancelEditing() {
    setEditingMessageId(null);
    setEditingText("");
  }

  async function resendEditedMessage(messageId: string) {
    const messageIndex = messages.findIndex((message) => message.id === messageId && message.role === "user");
    const trimmed = editingText.trim();
    if (messageIndex < 0 || !trimmed || loading) return;
    const baseMessages = messages.slice(0, messageIndex);
    setEditingMessageId(null);
    setEditingText("");
    await sendMessage(trimmed, baseMessages, messageId, contextAttachments);
  }

  function clearHistory() {
    void releaseAiAssistantAttachments([...attachments, ...contextAttachments]);
    setMessages([]);
    setAttachments([]);
    setContextAttachments([]);
    void db.aiAttachmentContexts.delete(aiAttachmentContextId(ownerId));
    showToast("历史已清空。", "success");
  }

  function removeContextAttachment(index: number) {
    setContextAttachments((current) => {
      const removed = current[index];
      if (removed) void releaseAiAssistantAttachments([removed]);
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      void saveAttachmentContext(ownerId, next);
      return next;
    });
  }

  return (
    <Modal
      title="AI 助手"
      onClose={onClose}
      wide
      className="ai-assistant-modal"
      headerExtra={(
        <label className="ai-header-access-code">
          <KeyRound size={14} />
          <input value={accessCode} placeholder="访问口令" aria-label="访问口令" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
      )}
    >
      <div className="assistant-dialog ai-assistant-dialog" onPaste={pasteAttachments}>
        <div className="ai-assistant-capability">
          <Sparkles size={16} />
          <span>能正常聊天，也能结合你的日程查安排、找冲突和创建记录；相对时间按北京时间理解。</span>
          <small>{configuration.supportsAttachments ? "支持图片与文档" : "智能问答已就绪"}</small>
        </div>
        <div ref={messagesRef} className="assistant-messages" role="log" aria-label="AI 助手对话">
          {!messages.length && !loading && (
            <div className="assistant-empty-state">
              <span className="assistant-empty-icon"><BrainCircuit size={24} /></span>
              <strong>今天想先处理什么？</strong>
              <p>直接提问，或从下面选一个开始。</p>
              <div className="assistant-quick-prompts">
                {QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <BrainCircuit size={18} /> : <UserRound size={18} />}
              <div className={`assistant-message-body ${editingMessageId === message.id ? "editing" : ""}`}>
                {editingMessageId === message.id ? (
                  <form className="assistant-message-edit" onSubmit={(event) => {
                    event.preventDefault();
                    void resendEditedMessage(message.id);
                  }}>
                    <textarea
                      ref={editingRef}
                      value={editingText}
                      aria-label="编辑消息内容"
                      disabled={loading}
                      onChange={(event) => setEditingText(event.target.value)}
                    />
                    <div className="assistant-message-edit-actions">
                      <button type="button" className="button secondary compact" disabled={loading} onClick={cancelEditing}>
                        <X size={15} />取消
                      </button>
                      <button
                        type="submit"
                        className="button primary compact"
                        disabled={loading || !editingText.trim()}
                        title="重新生成后续回答，并按一次新的 AI 请求计入额度"
                      >
                        <Send size={15} />重新发送
                      </button>
                    </div>
                  </form>
                ) : (
                  <p>
                    {message.content}
                    <span className="assistant-inline-actions">
                      <button type="button" className="icon-button" title="复制" aria-label="复制这条消息" onClick={() => void copyMessage(message.content)}><Clipboard size={13} /></button>
                      {message.role === "user" && (
                        <button type="button" className="icon-button" title="编辑并重新生成" aria-label="编辑这条消息" disabled={loading} onClick={() => editMessage(message)}><PencilLine size={13} /></button>
                      )}
                    </span>
                  </p>
                )}
              </div>
            </article>
          ))}
          {loading && (
            <article className="assistant">
              <BrainCircuit size={18} />
              <p className="assistant-thinking">正在理解问题并核对时间与日程<span aria-hidden="true">···</span></p>
            </article>
          )}
        </div>
        <form className="assistant-input" onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}>
          {contextAttachments.length > 0 && (
            <div className="assistant-attachments assistant-context-attachments" aria-label="附件上下文">
              <small>上下文</small>
              {contextAttachments.map((attachment, index) => (
                <span key={`context-${attachment.name}-${index}`}>
                  {attachment.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  <strong>{attachment.name}</strong>
                  <button type="button" className="icon-button" aria-label={`移除上下文 ${attachment.name}`} onClick={() => removeContextAttachment(index)}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="assistant-attachments">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`}>
                  {attachment.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  <strong>{attachment.name}</strong>
                  <button type="button" className="icon-button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => {
                    const removed = current[index];
                    if (removed) void releaseAiAssistantAttachments([removed]);
                    return current.filter((_, itemIndex) => itemIndex !== index);
                  })}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            className="assistant-composer-textarea"
            value={question}
            disabled={loading || Boolean(editingMessageId)}
            placeholder="例如：创建端午节，或明天 9:00 添加交作业"
            rows={2}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void ask();
            }}
          />
          {configuration.supportsAttachments && <p className="attachment-paste-hint">电脑端可按 Ctrl+V 粘贴截图或文件</p>}
          <div className="assistant-composer-actions">
            <button type="button" className="button secondary assistant-clear-button" aria-label="删除对话" disabled={loading || Boolean(editingMessageId) || messages.length === 0} onClick={clearHistory}><Trash2 size={15} /><span>删除</span></button>
            {configuration.supportsAttachments && (
              <AttachmentSourcePicker
                className="assistant-attachment-button"
                imageAccept={AI_IMAGE_ACCEPT}
                documentAccept={AI_DOCUMENT_ACCEPT}
                label={preparingAttachment ? attachmentProgress || "读取中" : "附件"}
                ariaLabel="导入图片或文档"
                disabled={loading || preparingAttachment || contextAttachments.length + attachments.length >= 3}
                onFiles={addAttachments}
              />
            )}
            {loading ? (
              <button type="button" className="button secondary assistant-send-button" onClick={() => {
                cancelAiTask("assistant");
                showToast("已停止生成，可继续修改或发送新问题。", "success");
              }}><Square size={14} />停止</button>
            ) : (
              <button className="button primary assistant-send-button" disabled={Boolean(editingMessageId) || (!question.trim() && attachments.length === 0)}><Send size={16} />发送</button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}

function loadAssistantHistory(ownerId: string): Message[] {
  try {
    const raw = localStorage.getItem(aiAssistantHistoryKey(ownerId));
    const saved = raw ? JSON.parse(raw) as Message[] : [];
    return saved.filter((message) =>
      message
      && message.id !== "welcome"
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    ).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveAssistantHistory(ownerId: string, messages: Message[]) {
  const saved = messages.slice(-HISTORY_LIMIT);
  localStorage.setItem(aiAssistantHistoryKey(ownerId), JSON.stringify(saved));
}

function aiAttachmentContextId(ownerId: string): string {
  return `ai-attachment-context:${ownerId}`;
}

async function loadAttachmentContext(ownerId: string): Promise<AiAssistantAttachment[]> {
  const id = aiAttachmentContextId(ownerId);
  const saved = await db.aiAttachmentContexts.get(id);
  if (!saved) return [];
  const age = Date.now() - new Date(saved.updatedAt).getTime();
  if (!Number.isFinite(age) || age > ATTACHMENT_CONTEXT_MAX_AGE_MS || !loadAssistantHistory(ownerId).length) {
    await db.aiAttachmentContexts.delete(id);
    return [];
  }
  return saved.attachments.slice(0, 3);
}

async function saveAttachmentContext(ownerId: string, attachments: AiAssistantAttachment[]): Promise<void> {
  const id = aiAttachmentContextId(ownerId);
  if (!attachments.length) {
    await db.aiAttachmentContexts.delete(id);
    return;
  }
  await db.aiAttachmentContexts.put({
    id,
    ownerId,
    attachments: attachments.slice(0, 3),
    updatedAt: new Date().toISOString()
  });
}

function mergeAttachments(existing: AiAssistantAttachment[], incoming: AiAssistantAttachment[]): AiAssistantAttachment[] {
  const merged = new Map(existing.map((attachment) => [`${attachment.kind}:${attachment.name}`, attachment]));
  incoming.forEach((attachment) => merged.set(`${attachment.kind}:${attachment.name}`, attachment));
  return [...merged.values()].slice(-3);
}

function replaceProcessedAttachments(current: AiAssistantAttachment[], processed: AiAssistantAttachment[]): AiAssistantAttachment[] {
  const replacements = new Map(processed.map((attachment) => [`${attachment.kind}:${attachment.name}`, attachment]));
  return current.map((attachment) => replacements.get(`${attachment.kind}:${attachment.name}`) ?? attachment);
}

function messagesToHistory(messages: Message[]): DeepSeekAssistantHistoryMessage[] {
  return messages
    .slice(-CONTEXT_LIMIT)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 800) }));
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

async function createRecordsFromActions(actions: DeepSeekAssistantAction[], sourceText: string, ownerId: string): Promise<AiCreatedRecord[]> {
  const created = recordsFromAiActions(actions, sourceText, ownerId);
  for (const item of created) {
    if (item.table === "events") await db.events.put(item.record);
    if (item.table === "anniversaries") await db.anniversaries.put(item.record);
    if (item.table === "memos") await db.memos.put(item.record);
    await queueChange(item.table, item.record.id);
  }
  return created;
}

function createdSummary(created: AiCreatedRecord[]): string {
  const labels = {
    events: "事项",
    anniversaries: "日子",
    memos: "备忘录"
  } as const;
  return Object.entries(labels).flatMap(([table, label]) => {
    const titles = created
      .filter((item) => item.table === table)
      .map((item) => item.record.title);
    return titles.length ? [`已创建${label}：${titles.join("、")}`] : [];
  }).join("\n");
}
