import { BrainCircuit, KeyRound, Send, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { askDeepSeekAssistant, buildDeepSeekScheduleContext } from "../lib/deepSeekAssistant";
import { SCHEDULE_ASSISTANT_EXAMPLES, type ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { Modal } from "./Modal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface DeepSeekAssistantDialogProps {
  input: ScheduleAssistantInput;
  userEmail?: string | null;
  onClose: () => void;
}

export function DeepSeekAssistantDialog({ input, userEmail, onClose }: DeepSeekAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "我是 DeepSeek AI 日程助手。启用后会把当前日程摘要发送到你的 Supabase Edge Function，再由服务端调用 DeepSeek。API Key 不会暴露在浏览器里。"
    }
  ]);
  const [question, setQuestion] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const context = useMemo(() => buildDeepSeekScheduleContext(input), [input]);

  async function ask(text = question) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setQuestion("");
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    try {
      const result = await askDeepSeekAssistant(trimmed, context, accessCode.trim());
      setMessages((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", content: result.answer }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? `暂时不能使用 DeepSeek 助手：${error.message}` : "暂时不能使用 DeepSeek 助手。"
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="DeepSeek AI 助手" onClose={onClose} wide>
      <div className="assistant-dialog">
        <section className="ai-access-panel">
          <BrainCircuit size={19} />
          <div>
            <strong>{userEmail ? `当前账号：${userEmail}` : "需要先登录账号"}</strong>
            <span>只有白名单账号、会员账号，或输入指定访问口令的用户可以调用 DeepSeek。</span>
          </div>
        </section>
        <label className="ai-access-code">
          <KeyRound size={16} />
          <input value={accessCode} placeholder="访问口令，可留空使用账号白名单" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
        <div className="assistant-examples" aria-label="DeepSeek 问日程样例">
          {SCHEDULE_ASSISTANT_EXAMPLES.map((example) => (
            <button key={example} type="button" disabled={loading} onClick={() => ask(example)}>{example}</button>
          ))}
        </div>
        <div className="assistant-messages" role="log" aria-label="DeepSeek 对话">
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <BrainCircuit size={18} /> : <UserRound size={18} />}
              <p>{message.content}</p>
            </article>
          ))}
          {loading && (
            <article className="assistant">
              <BrainCircuit size={18} />
              <p>正在让 DeepSeek 分析日程…</p>
            </article>
          )}
        </div>
        <form className="assistant-input" onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}>
          <input
            autoFocus
            value={question}
            disabled={loading}
            placeholder="例如：帮我安排今天剩下的时间"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="button primary" disabled={loading}><Send size={16} />发送</button>
        </form>
      </div>
    </Modal>
  );
}
