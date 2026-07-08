import { BrainCircuit, Clipboard, KeyRound, PencilLine, Send, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, queueChange } from "../db";
import { askDeepSeekAssistant, buildDeepSeekScheduleContext, type DeepSeekAssistantAction, type DeepSeekAssistantHistoryMessage } from "../lib/deepSeekAssistant";
import { eventItemFromAiAction } from "../lib/aiEventActions";
import { SCHEDULE_ASSISTANT_EXAMPLES, type ScheduleAssistantInput } from "../lib/scheduleAssistant";
import type { EventItem } from "../types";
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
    content: "我是 AI 日程助手，可以根据你的日程摘要回答安排、冲突、未完成事项和时间规划问题。"
  };
}

export function DeepSeekAssistantDialog({ input, ownerId, userEmail, onClose }: DeepSeekAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadAssistantHistory(ownerId));
  const [question, setQuestion] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const context = useMemo(() => buildDeepSeekScheduleContext(input), [input]);

  useEffect(() => {
    setMessages(loadAssistantHistory(ownerId));
  }, [ownerId]);

  useEffect(() => {
    saveAssistantHistory(ownerId, messages);
  }, [messages, ownerId]);

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
      if (result.accessBound) setAccessCode("");
      const created = await createEventsFromActions(result.actions ?? [], trimmed, ownerId);
      const content = [
        result.answer,
        result.accessBound ? "已为当前账号开通 AI 助手，下次可不填访问口令。" : "",
        created.length ? `已创建事项：${created.map((item) => item.title).join("、")}` : ""
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
      <div className="assistant-dialog ai-assistant-dialog">
        <section className="ai-access-panel">
          <BrainCircuit size={19} />
          <div>
            <strong>{userEmail ? `当前账号：${userEmail}` : "需要先登录账号"}</strong>
            <span>只有会员账号，或输入指定访问口令后，才可以使用 AI 助手。</span>
          </div>
        </section>
        <label className="ai-access-code">
          <KeyRound size={16} />
          <input value={accessCode} placeholder="访问口令，会员账号可不填" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
        <div className="assistant-examples" aria-label="AI 助手问日程样例">
          {SCHEDULE_ASSISTANT_EXAMPLES.map((example) => (
            <button key={example} type="button" disabled={loading} onClick={() => ask(example)}>{example}</button>
          ))}
          {messages.length > 1 && (
            <button type="button" disabled={loading} onClick={clearHistory}><Trash2 size={13} />清空历史</button>
          )}
        </div>
        {feedback && <p className="assistant-feedback">{feedback}</p>}
        <div className="assistant-messages" role="log" aria-label="AI 助手对话">
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <BrainCircuit size={18} /> : <UserRound size={18} />}
              <div className="assistant-message-body">
                <p>{message.content}</p>
                {message.id !== "welcome" && (
                  <div className="assistant-message-actions">
                    <button type="button" className="icon-button" title="复制" onClick={() => void copyMessage(message.content)}><Clipboard size={14} /></button>
                    {message.role === "user" && (
                      <button type="button" className="icon-button" title="重新编辑" onClick={() => editMessage(message.content)}><PencilLine size={14} /></button>
                    )}
                  </div>
                )}
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
            autoFocus
            value={question}
            disabled={loading}
            placeholder="例如：明天 9:00 添加交作业"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="button primary" disabled={loading}><Send size={16} />发送</button>
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

async function createEventsFromActions(actions: DeepSeekAssistantAction[], sourceText: string, ownerId: string): Promise<EventItem[]> {
  const created: EventItem[] = [];
  for (const action of actions) {
    const record = eventItemFromAiAction(action, sourceText, ownerId);
    if (!record) continue;
    await db.events.put(record);
    await queueChange("events", record.id);
    created.push(record);
  }
  return created;
}
