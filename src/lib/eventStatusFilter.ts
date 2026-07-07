export type EventStatusFilter = "all" | "incomplete" | "completed";

export function eventOccurrenceMatchesStatus(completed: boolean, filter: EventStatusFilter): boolean {
  if (filter === "completed") return completed;
  if (filter === "incomplete") return !completed;
  return true;
}
