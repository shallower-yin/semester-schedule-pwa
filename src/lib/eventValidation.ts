export interface EventDraftValidationInput {
  title: string;
  startDate?: string;
  endDate?: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
}

export function validateEventDraft(input: EventDraftValidationInput): string | null {
  if (!input.title.trim()) return "请填写事项标题。";
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return "结束日期不能早于开始日期。";
  }
  if (!input.allDay && input.endTime < input.startTime) {
    return "结束时间不能早于开始时间。如果只需要一个提醒，可以把开始时间和结束时间设为相同。";
  }
  return null;
}
