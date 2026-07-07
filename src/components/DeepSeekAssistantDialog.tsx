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
      content: "我是 AI 日程助手，可以根据你的日程摘要回答安排、冲突、未完成事项和时间规划问题。"
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
        content: error instanceof Error ? `暂时不能使用 AI 助手：${error.message}` : "暂时不能使用 AI 助手。"
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="AI 助手" onClose={onClose} wide>
      <div className="assistant-dialog">
        <section className="ai-access-panel">
          <BrainCircuit size={19} />
          <div>
            <strong>{userEmail ? `当前账号：${userEmail}` : "需要先登录账号"}</strong>
            <span>只有已开通账号，或输入指定访问口令后，才可以使用 AI 助手。</span>
          </div>
        </section>
        <label className="ai-access-code">
          <KeyRound size={16} />
          <input value={accessCode} placeholder="访问口令，可留空使用账号白名单" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
        <div className="assistant-examples" aria-label="AI 助手问日程样例">
          {SCHEDULE_ASSISTANT_EXAMPLES.map((example) => (
            <button key={example} type="button" disabled={loading} onClick={() => ask(example)}>{example}</button>
          ))}
        </div>
        <div className="assistant-messages" role="log" aria-label="AI 助手对话">
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <BrainCircuit size={18} /> : <UserRound size={18} />}
              <p>{message.content}</p>
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
