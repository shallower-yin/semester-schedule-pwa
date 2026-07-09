import { BrainCircuit, Clipboard, KeyRound, PencilLine, Send, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import { askDeepSeekAssistant, buildDeepSeekScheduleContext, type DeepSeekAssistantAction, type DeepSeekAssistantHistoryMessage } from "../lib/deepSeekAssistant";
import { recordsFromAiActions, type AiCreatedRecord } from "../lib/aiEventActions";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { Modal } from "./Modal";

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
const CONTEXT_LIMIT = 6;

function aiAssistantHistoryKey(ownerId: string) {
  return `semester-schedule-ai-assistant-history:${ownerId}`;
}

function welcomeMessage(): Message {
  return {
    id: "welcome",
    role: "assistant",
    content: "我是 AI 助手，可以回答日程和使用问题，也能帮你创建事项、习惯、纪念日、生日、节日和备忘录。"
  };
}

export function DeepSeekAssistantDialog({ input, ownerId, onClose }: DeepSeekAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadAssistantHistory(ownerId));
  const [question, setQuestion] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const context = useMemo(() => buildDeepSeekScheduleContext(input), [input]);

  useEffect(() => {
    setMessages(loadAssistantHistory(ownerId));
  }, [ownerId]);

  useEffect(() => {
    saveAssistantHistory(ownerId, messages);
  }, [messages, ownerId]);

  useEffect(() => {
    window.setTimeout(() => rootRef.current?.closest(".modal")?.scrollTo({ top: 0 }), 0);
  }, []);

  async function ask(text = question) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messagesToHistory(messages);
    setLoading(true);
    setQuestion("");
    setFeedback("");
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    try {
      const result = await askDeepSeekAssistant(trimmed, context, accessCode.trim(), history);
      if (result.access === "access-code") setAccessCode("");
      const created = await createRecordsFromActions(result.actions ?? [], trimmed, ownerId);
      const content = [
        result.answer,
        created.length ? createdSummary(created) : ""
      ].filter(Boolean).join("\n");
      setMessages((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", content }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? `暂时不能使用 AI 助手：${error.message}` : "暂时不能使用 AI 助手。"
      }]);
    } finally {
      setLoading(false);
    }
  }

  async function copyMessage(content: string) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(content);
      } else {
        copyTextFallback(content);
      }
      setFeedback("已复制。");
    } catch {
      copyTextFallback(content);
      setFeedback("已复制。");
    }
  }

  function editMessage(content: string) {
    setQuestion(content);
    setFeedback("已放回输入框，可修改后重新发送。");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function clearHistory() {
    setMessages([welcomeMessage()]);
    setFeedback("历史已清空。");
  }

  return (
    <Modal title="AI 助手" onClose={onClose} wide>
      <div ref={rootRef} className="assistant-dialog ai-assistant-dialog">
        <p className="ai-assistant-capability">可询问安排、冲突、未完成、专注统计和使用方法；也可直接创建事项、习惯、纪念日、生日、节日和备忘录。</p>
        <label className="ai-access-code">
          <KeyRound size={16} />
          <input value={accessCode} placeholder="访问口令，临时体验可填" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
        <p className="assistant-feedback" aria-live="polite">{feedback}</p>
        <div className="assistant-messages" role="log" aria-label="AI 助手对话">
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <BrainCircuit size={18} /> : <UserRound size={18} />}
              <div className="assistant-message-body">
                <p>
                  {message.content}
                  {message.id !== "welcome" && (
                    <span className="assistant-inline-actions">
                      <button type="button" className="icon-button" title="复制" onClick={() => void copyMessage(message.content)}><Clipboard size={13} /></button>
                      {message.role === "user" && (
                        <button type="button" className="icon-button" title="重新编辑" onClick={() => editMessage(message.content)}><PencilLine size={13} /></button>
                      )}
                    </span>
                  )}
                </p>
              </div>
            </article>
          ))}
          {loading && (
            <article className="assistant">
              <BrainCircuit size={18} />
              <p>正在分析日程...</p>
            </article>
          )}
        </div>
        <form className="assistant-input" onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}>
          <input
            ref={inputRef}
            value={question}
            disabled={loading}
            placeholder="例如：创建端午节，或明天 9:00 添加交作业"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="button primary" disabled={loading}><Send size={16} />发送</button>
          {messages.length > 1 && (
            <button type="button" className="button secondary" disabled={loading} onClick={clearHistory}><Trash2 size={15} />清空</button>
          )}
        </form>
      </div>
    </Modal>
  );
}

function loadAssistantHistory(ownerId: string): Message[] {
  try {
    const raw = localStorage.getItem(aiAssistantHistoryKey(ownerId));
    const saved = raw ? JSON.parse(raw) as Message[] : [];
    const validSaved = saved.filter((message) =>
      message
      && message.id !== "welcome"
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    ).slice(-HISTORY_LIMIT);
    return [welcomeMessage(), ...validSaved];
  } catch {
    return [welcomeMessage()];
  }
}

function saveAssistantHistory(ownerId: string, messages: Message[]) {
  const saved = messages
    .filter((message) => message.id !== "welcome")
    .slice(-HISTORY_LIMIT);
  localStorage.setItem(aiAssistantHistoryKey(ownerId), JSON.stringify(saved));
}

function messagesToHistory(messages: Message[]): DeepSeekAssistantHistoryMessage[] {
  return messages
    .filter((message) => message.id !== "welcome")
    .slice(-CONTEXT_LIMIT)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 500) }));
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
