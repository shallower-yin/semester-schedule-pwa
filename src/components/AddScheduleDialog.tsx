import { BookOpen, CalendarPlus } from "lucide-react";
import { Modal } from "./Modal";

interface AddScheduleDialogProps {
  onAddCourse: () => void;
  onAddEvent: () => void;
  onClose: () => void;
}

export function AddScheduleDialog({ onAddCourse, onAddEvent, onClose }: AddScheduleDialogProps) {
  return (
    <Modal title="新增日程" onClose={onClose}>
      <div className="add-type-grid">
        <button onClick={onAddCourse}>
          <BookOpen />
          <span><strong>课程</strong><small>按星期、节次和指定周数重复</small></span>
        </button>
        <button onClick={onAddEvent}>
          <CalendarPlus />
          <span><strong>临时事项</strong><small>指定日期、时间或每周重复</small></span>
        </button>
      </div>
    </Modal>
  );
}
