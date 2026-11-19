import { assertEquals } from "jsr:@std/assert@1";
import { buildReminderPayload, type ReminderRow } from "./payload.ts";

const row: ReminderRow = {
  delivery_id: "delivery-1", source_type: "course", source_id: "course-1", course_schedule_id: "schedule-1",
  title: "新材料制造学", occurrence_date: "2026-11-19", start_time: "13:30:00", all_day: false,
  location: "55楼A区308", endpoint: "https://push.example/subscription", p256dh: "test", auth: "test"
};
const appUrl = "https://example.com/schedule/";

Deno.test("课程推送展示上课时间和教室，并保留课程和安排的跳转标识", () => {
  const payload = buildReminderPayload(row, appUrl);
  assertEquals(payload.title, "新材料制造学");
  assertEquals(payload.body, "2026-11-19 13:30 开始 · 55楼A区308");
  assertEquals(payload.tag, "course-course-1-schedule-1-2026-11-19");
  assertEquals(new URL(payload.url).pathname, "/schedule/");
  assertEquals(new URL(payload.url).searchParams.get("notification"), "course:course-1:schedule-1:2026-11-19");
});

Deno.test("其他提醒仍使用原有内容和跳转协议", () => {
  const event = buildReminderPayload({ ...row, source_type: "event" }, appUrl);
  assertEquals(new URL(event.url).searchParams.get("notification"), "event:course-1:2026-11-19");
  assertEquals(event.body, "2026-11-19 13:30 开始 · 55楼A区308");
  const todo = buildReminderPayload({ ...row, source_type: "todo" }, appUrl);
  assertEquals(new URL(todo.url).searchParams.get("notification"), "todo:course-1");
  assertEquals(todo.body, "2026-11-19 13:30 待办提醒");
  const health = buildReminderPayload({ ...row, source_type: "health" }, appUrl);
  assertEquals(health.tag, "health-movement-reminder");
  assertEquals(health.url, appUrl);
});
