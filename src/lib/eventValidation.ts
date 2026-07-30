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
  if (
    !input.allDay
    && input.endTime < input.startTime
    && (!input.startDate || !input.endDate || input.endDate === input.startDate)
  ) {
    return "跨夜事项请把结束日期设为第二天；同一天的结束时间不能早于开始时间。";
  }
  return null;
}
