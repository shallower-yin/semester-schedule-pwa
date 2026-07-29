import { describe, expect, it } from "vitest";
import { normalizeAiFeatureQuotas } from "./aiFeatures";

describe("AI 分项额度", () => {
  it("保留 0 额度并分别归一化每个功能", () => {
    const quotas = normalizeAiFeatureQuotas({
      assistant: { enabled_for_all: true, ordinary_daily_limit: 2, ordinary_weekly_limit: 7, member_daily_limit: 9, member_weekly_limit: 30 },
      translation: { enabled_for_all: true, ordinary_daily_limit: 10, ordinary_weekly_limit: 50, member_daily_limit: 20, member_weekly_limit: 100 },
      mind_map: { enabled_for_all: false, ordinary_daily_limit: 0, ordinary_weekly_limit: 0, member_daily_limit: 3, member_weekly_limit: 10 },
      audio_transcription: { enabled_for_all: true, ordinary_daily_limit: 0, ordinary_weekly_limit: 0, member_daily_limit: 1, member_weekly_limit: 2 }
    });

    expect(quotas.assistant.ordinary_daily_limit).toBe(2);
    expect(quotas.translation.ordinary_weekly_limit).toBe(50);
    expect(quotas.mind_map.ordinary_daily_limit).toBe(0);
    expect(quotas.audio_transcription.enabled_for_all).toBe(true);
  });
});
