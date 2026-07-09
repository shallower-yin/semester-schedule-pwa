import { BookOpen, ChevronRight, Plus } from "lucide-react";
import type { Course, CourseSchedule } from "../types";
import { Modal } from "./Modal";

interface CourseManagerDialogProps {
  courses: Course[];
  schedules: CourseSchedule[];
  onAdd: () => void;
  onEdit: (course: Course) => void;
  onClose: () => void;
}

export function CourseManagerDialog({ courses, schedules, onAdd, onEdit, onClose }: CourseManagerDialogProps) {
  return (
    <Modal title="课程管理" onClose={onClose} wide>
      <div className="course-manager-toolbar">
        <p>课程和临时事项统一显示在日程中。</p>
        <button className="button primary compact" onClick={onAdd}><Plus size={17} />新增课程</button>
      </div>
      {courses.length ? (
        <div className="course-list">
          {courses.map((course) => (
            <button className="course-list-item" key={course.id} onClick={() => onEdit(course)}>
              <span className="course-color" style={{ background: course.color }} />
              <span className="course-main">
                <strong>{course.name}</strong>
                <small>{[course.teacher, course.classroom].filter(Boolean).join(" · ") || "未填写教师和教室"}</small>
              </span>
              <span className="course-count">{schedules.filter((schedule) => schedule.course_id === course.id).length} 个安排</span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <BookOpen size={30} />
          <h2>还没有课程</h2>
          <p>先新增一门课程，再添加上课周次、星期和节次。</p>
          <button type="button" className="button primary compact" onClick={onAdd}><Plus size={17} />添加第一门课程</button>
        </div>
      )}
    </Modal>
  );
}
