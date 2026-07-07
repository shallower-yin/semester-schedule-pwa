import type { EventRecurrenceType, EventType } from "../types";

const STORAGE_KEY = "semester-schedule-event-templates";

export interface EventTemplate {
  id: string;
  name: string;
  event_type: EventType;
  title: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  category_id: string | null;
  color: string;
  note: string;
  recurrence_type: EventRecurrenceType;
  recurrence_interval: number;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  updated_at: string;
}

export function loadEventTemplates(): EventTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEventTemplate(template: Omit<EventTemplate, "id" | "updated_at">): EventTemplate {
  const templates = loadEventTemplates();
  const record: EventTemplate = {
    ...template,
    id: crypto.randomUUID(),
    updated_at: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...templates].slice(0, 30)));
  return record;
}

export function deleteEventTemplate(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadEventTemplates().filter((template) => template.id !== id)));
}
