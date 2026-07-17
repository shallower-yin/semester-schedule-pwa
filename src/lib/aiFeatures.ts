export const AI_FEATURE_KEYS = ["assistant", "mind_map", "audio_transcription"] as const;

export type AiFeatureKey = typeof AI_FEATURE_KEYS[number];

export interface AiFeatureQuota {
  enabled_for_all: boolean;
  ordinary_daily_limit: number;
  ordinary_weekly_limit: number;
  member_daily_limit: number;
  member_weekly_limit: number;
}

export type AiFeatureQuotas = Record<AiFeatureKey, AiFeatureQuota>;

export const AI_FEATURE_LABELS: Record<AiFeatureKey, string> = {
  assistant: "AI 助手",
  mind_map: "AI 思维导图",
  audio_transcription: "音频转写"
};

export function defaultAiFeatureQuotas(): AiFeatureQuotas {
  return {
    assistant: featureQuota(true, 20, 100, 50, 300),
    mind_map: featureQuota(true, 20, 100, 50, 300),
    audio_transcription: featureQuota(false, 0, 0, 5, 20)
  };
}

export function normalizeAiFeatureQuotas(
  value: unknown,
  legacy?: Partial<AiFeatureQuota>
): AiFeatureQuotas {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const defaults = defaultAiFeatureQuotas();
  const legacyQuota = featureQuota(
    Boolean(legacy?.enabled_for_all),
    quotaNumber(legacy?.ordinary_daily_limit, defaults.assistant.ordinary_daily_limit),
    quotaNumber(legacy?.ordinary_weekly_limit, defaults.assistant.ordinary_weekly_limit),
    quotaNumber(legacy?.member_daily_limit, defaults.assistant.member_daily_limit),
    quotaNumber(legacy?.member_weekly_limit, defaults.assistant.member_weekly_limit)
  );
  return {
    assistant: normalizeFeatureQuota(source.assistant, legacy ? legacyQuota : defaults.assistant),
    mind_map: normalizeFeatureQuota(source.mind_map, legacy ? legacyQuota : defaults.mind_map),
    audio_transcription: normalizeFeatureQuota(source.audio_transcription, defaults.audio_transcription)
  };
}

function normalizeFeatureQuota(value: unknown, fallback: AiFeatureQuota): AiFeatureQuota {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const ordinaryDaily = quotaNumber(row.ordinary_daily_limit, fallback.ordinary_daily_limit);
  const memberDaily = quotaNumber(row.member_daily_limit, fallback.member_daily_limit);
  return featureQuota(
    typeof row.enabled_for_all === "boolean" ? row.enabled_for_all : fallback.enabled_for_all,
    ordinaryDaily,
    Math.max(ordinaryDaily, quotaNumber(row.ordinary_weekly_limit, fallback.ordinary_weekly_limit, 1_000_000)),
    memberDaily,
    Math.max(memberDaily, quotaNumber(row.member_weekly_limit, fallback.member_weekly_limit, 1_000_000))
  );
}

function featureQuota(
  enabledForAll: boolean,
  ordinaryDaily: number,
  ordinaryWeekly: number,
  memberDaily: number,
  memberWeekly: number
): AiFeatureQuota {
  return {
    enabled_for_all: enabledForAll,
    ordinary_daily_limit: ordinaryDaily,
    ordinary_weekly_limit: ordinaryWeekly,
    member_daily_limit: memberDaily,
    member_weekly_limit: memberWeekly
  };
}

function quotaNumber(value: unknown, fallback: number, max = 100_000): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(0, Math.floor(numeric))) : fallback;
}
