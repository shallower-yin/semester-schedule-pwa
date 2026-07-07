import { Bell, BookOpen, CalendarHeart, CheckCircle2, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Anniversary, Category, Course, EventItem, Memo } from "../types";
import { anniversaryKindLabel } from "../lib/anniversaries";
import { Modal } from "./Modal";

export type GlobalSearchResult =
  | { type: "course"; id: string }
  | { type: "event"; id: string }
  | { type: "anniversary"; id: string }
  | { type: "memo"; id: string };

interface GlobalSearchDialogProps {
  courses: Course[];
  events: EventItem[];
  categories: Category[];
  anniversaries: Anniversary[];
  memos: Memo[];
  onOpen: (result: GlobalSearchResult) => void;
  onClose: () => void;
}

interface SearchItem {
  type: GlobalSearchResult["type"];
  id: string;
  title: string;
  subtitle: string;
  body: string;
}

export function GlobalSearchDialog({ courses, events, categories, anniversaries, memos, onOpen, onClose }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const items = useMemo<SearchItem[]>(() => [
    ...courses.filter((course) => !course.deleted_at).map((course) => ({
      type: "course" as const,
      id: course.id,
      title: course.name,
      subtitle: [course.teacher, course.classroom].filter(Boolean).join(" · ") || "课程",
      body: [course.name, course.teacher, course.classroom, course.note].join("\n")
    })),
    ...events.filter((eventItem) => !eventItem.deleted_at).map((eventItem) => {
      const category = eventItem.category_id ? categoryMap.get(eventItem.category_id) : undefined;
      return {
        type: "event" as const,
        id: eventItem.id,
        title: eventItem.title,
        subtitle: `${eventItem.event_type === "habit" ? "习惯" : "事项"} · ${eventItem.start_date}${eventItem.end_date !== eventItem.start_date ? ` 至 ${eventItem.end_date}` : ""}`,
        body: [eventItem.title, eventItem.note, category?.name ?? ""].join("\n")
      };
    }),
    ...anniversaries.filter((anniversary) => !anniversary.deleted_at).map((anniversary) => ({
      type: "anniversary" as const,
      id: anniversary.id,
      title: anniversary.title,
      subtitle: `${anniversaryKindLabel(anniversary.kind)} · ${anniversary.date}`,
      body: [anniversary.title, anniversary.note, anniversaryKindLabel(anniversary.kind)].join("\n")
    })),
    ...memos.filter((memo) => !memo.deleted_at).map((memo) => ({
      type: "memo" as const,
      id: memo.id,
      title: memo.title,
      subtitle: "备忘录",
      body: [memo.title, memo.content].join("\n")
    }))
  ], [anniversaries, categoryMap, courses, events, memos]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items.slice(0, 12);
    return items
      .filter((item) => item.body.toLowerCase().includes(normalized))
      .slice(0, 30);
  }, [items, query]);

  function openItem(item: SearchItem) {
    onOpen({ type: item.type, id: item.id } as GlobalSearchResult);
  }

  return (
    <Modal title="全局搜索" onClose={onClose} wide>
      <div className="global-search-dialog">
        <label className="global-search-box">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程、事项、习惯、纪念日或备忘录" />
        </label>
        <div className="global-search-results" role="list" aria-label="搜索结果">
          {visibleItems.length ? visibleItems.map((item) => {
            const Icon = item.type === "course"
              ? BookOpen
              : item.type === "anniversary"
                ? CalendarHeart
                : item.type === "memo"
                  ? FileText
                  : item.subtitle.startsWith("习惯")
                    ? CheckCircle2
                    : Bell;
            return (
              <button key={`${item.type}-${item.id}`} type="button" onClick={() => openItem(item)} role="listitem">
                <Icon size={18} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
              </button>
            );
          }) : (
            <p className="overview-empty">{query ? "没有匹配结果。" : "输入关键词开始搜索。"}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
