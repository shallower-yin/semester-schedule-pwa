import { Bot, Send, UserRound } from "lucide-react";
import { useState } from "react";
import { answerScheduleQuestion, SCHEDULE_ASSISTANT_EXAMPLES, type ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { Modal } from "./Modal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ScheduleAssistantDialogProps {
  input: ScheduleAssistantInput;
  onClose: () => void;
}

export function ScheduleAssistantDialog({ input, onClose }: ScheduleAssistantDialogProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "我是本地问日程助手，只读取当前浏览器里的日程数据。可以问今天安排、明天未完成、课程教室、逾期事项、完成率、专注时长和冲突。"
    }
  ]);
  const [question, setQuestion] = useState("");

  function ask(text = question) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const answer = answerScheduleQuestion(trimmed, { ...input, now: new Date() });
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: "user", content: trimmed },
      { id: `a-${Date.now()}`, role: "assistant", content: answer }
    ]);
    setQuestion("");
  }

  return (
    <Modal title="问日程助手" onClose={onClose} wide>
      <div className="assistant-dialog">
        <div className="assistant-examples" aria-label="问日程样例">
          {SCHEDULE_ASSISTANT_EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => ask(example)}>{example}</button>
          ))}
        </div>
        <div className="assistant-messages" role="log" aria-label="问日程对话">
          {messages.map((message) => (
            <article key={message.id} className={message.role}>
              {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <form className="assistant-input" onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}>
          <input
            autoFocus
            value={question}
            placeholder="例如：明天有哪些未完成事项？"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="button primary"><Send size={16} />发送</button>
        </form>
      </div>
    </Modal>
  );
}
