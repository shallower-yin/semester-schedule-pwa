import { describe, expect, it } from "vitest";
import { eventOccurrenceMatchesStatus } from "./eventStatusFilter";

describe("事项完成状态筛选", () => {
  it("按每次出现的完成状态过滤事项", () => {
    expect(eventOccurrenceMatchesStatus(false, "all")).toBe(true);
    expect(eventOccurrenceMatchesStatus(true, "all")).toBe(true);
    expect(eventOccurrenceMatchesStatus(false, "incomplete")).toBe(true);
    expect(eventOccurrenceMatchesStatus(true, "incomplete")).toBe(false);
    expect(eventOccurrenceMatchesStatus(true, "completed")).toBe(true);
    expect(eventOccurrenceMatchesStatus(false, "completed")).toBe(false);
  });
});
