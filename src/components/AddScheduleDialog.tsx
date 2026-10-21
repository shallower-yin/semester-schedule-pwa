import { BookOpen, CalendarPlus, CheckCircle2, Sparkles } from "lucide-react";
import { Modal } from "./Modal";

interface AddScheduleDialogProps {
  courseAvailable?: boolean;
  onAddCourse: () => void;
  onAddEvent: () => void;
  onAddHabit: () => void;
  onQuickEntry: () => void;
  onClose: () => void;
}

export function AddScheduleDialog({ courseAvailable = true, onAddCourse, onAddEvent, onAddHabit, onQuickEntry, onClose }: AddScheduleDialogProps) {
  return (
    <Modal title="新增日程" onClose={onClose}>
      <div className="add-type-grid">
        <button onClick={onQuickEntry}>
          <Sparkles />
          <span><strong>快速录入</strong></span>
        </button>
        <button onClick={onAddCourse}>
          <BookOpen />
          <span><strong>课程</strong></span>
        </button>
        <button onClick={onAddEvent}>
          <CalendarPlus />
          <span><strong>临时事项</strong></span>
        </button>
        <button onClick={onAddHabit}>
          <CheckCircle2 />
          <span><strong>习惯</strong></span>
        </button>
      </div>
      {!courseAvailable && <p className="muted-note">添加课程需先创建学期。</p>}
    </Modal>
  );
}
