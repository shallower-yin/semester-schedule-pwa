import { BookOpen, CalendarPlus, CheckCircle2, Sparkles } from "lucide-react";
import { Modal } from "./Modal";

interface AddScheduleDialogProps {
  onAddCourse: () => void;
  onAddEvent: () => void;
  onAddHabit: () => void;
  onQuickEntry: () => void;
  onClose: () => void;
}

export function AddScheduleDialog({ onAddCourse, onAddEvent, onAddHabit, onQuickEntry, onClose }: AddScheduleDialogProps) {
  return (
    <Modal title="新增日程" onClose={onClose}>
      <div className="add-type-grid">
        <button onClick={onQuickEntry}>
          <Sparkles />
          <span><strong>快速录入</strong><small>用一句话创建事项，并查看可用格式样例</small></span>
        </button>
        <button onClick={onAddCourse}>
          <BookOpen />
          <span><strong>课程</strong><small>按星期、节次和指定周数重复</small></span>
        </button>
        <button onClick={onAddEvent}>
          <CalendarPlus />
          <span><strong>临时事项</strong><small>指定日期、时间或每周重复</small></span>
        </button>
        <button onClick={onAddHabit}>
          <CheckCircle2 />
          <span><strong>习惯</strong><small>定义一段日期范围，每天打卡并统计</small></span>
        </button>
      </div>
    </Modal>
  );
}
