export type AiProvider = "deepseek" | "mimo" | "siliconflow" | "tju";
export type AudioProvider = "mimo" | "siliconflow";
export type MimoChannel = "payg" | "token_plan";

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
  ],
  siliconflow: [
    { id: "Qwen/Qwen3-32B", label: "SiliconFlow Qwen3-32B", supportsAttachments: false },
    { id: "deepseek-ai/DeepSeek-V3", label: "SiliconFlow DeepSeek-V3", supportsAttachments: false },
    { id: "deepseek-ai/DeepSeek-R1", label: "SiliconFlow DeepSeek-R1", supportsAttachments: false }
  ],
  tju: [
    { id: "tju-llm", label: "TJU Agent2026 tju-llm", supportsAttachments: false }
  ]
};

export interface AudioModelOption {
  id: string;
  label: string;
}

export const AUDIO_MODEL_OPTIONS: Record<AudioProvider, readonly AudioModelOption[]> = {
  mimo: [
    { id: "mimo-v2.5-asr", label: "MiMo V2.5 ASR" }
  ],
  siliconflow: [
    { id: "TeleAI/TeleSpeechASR", label: "SiliconFlow TeleAI/TeleSpeechASR" },
    { id: "FunAudioLLM/SenseVoiceSmall", label: "SiliconFlow SenseVoiceSmall" }
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

export function defaultAudioModel(provider: AudioProvider): string {
  return AUDIO_MODEL_OPTIONS[provider][0].id;
}

export function isSupportedAudioModel(provider: AudioProvider, model: string): boolean {
  return AUDIO_MODEL_OPTIONS[provider].some((option) => option.id === model);
}
