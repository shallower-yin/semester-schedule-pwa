export type AiProvider = "deepseek" | "mimo";

export interface AiModelOption {
  id: string;
  label: string;
  supportsAttachments: boolean;
}

export const AI_MODEL_OPTIONS: Record<AiProvider, readonly AiModelOption[]> = {
  deepseek: [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", supportsAttachments: false },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", supportsAttachments: false }
  ],
  mimo: [
    { id: "mimo-v2.5", label: "MiMo V2.5（支持附件）", supportsAttachments: true },
    { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", supportsAttachments: false },
    { id: "mimo-v2.5-pro-ultraspeed", label: "MiMo V2.5 Pro UltraSpeed（需申请）", supportsAttachments: false }
  ]
};

export function defaultAiModel(provider: AiProvider): string {
  return AI_MODEL_OPTIONS[provider][0].id;
}

export function aiModelSupportsAttachments(provider: AiProvider, model: string): boolean {
  return AI_MODEL_OPTIONS[provider].some((option) => option.id === model && option.supportsAttachments);
}

export function isSupportedAiModel(provider: AiProvider, model: string): boolean {
  return AI_MODEL_OPTIONS[provider].some((option) => option.id === model);
}
