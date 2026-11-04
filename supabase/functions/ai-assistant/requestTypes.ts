import type { AudioSubmission } from "../_shared/audioSubmission.ts";
import type { TextProvider } from "../_shared/textProviderRequest.ts";

export interface AiAssistantRequest {
  action?: "configuration" | "create_audio_upload" | "delete_audio_upload" | "close_audio_submission" | "transcribe_audio_range" | "transcribe_audio_part" | "plan_audio_transcription" | "plan_audio_parts" | "finalize_audio_transcription" | "summarize_audio_transcript" | "create_document_page_uploads" | "extract_document_batch" | "summarize_document_batch" | "delete_document_uploads";
  audioSubmission?: AudioSubmission;
  audioSubmissionId?: string;
  /** Plain transcript text for summarize_audio_transcript (no R2). */
  audioTranscript?: string;
  /** When true, finalize only merges segments / optional summary and does not touch R2 objects. */
  skipAudioObjectCleanup?: boolean;
  mode?: "assistant" | "translation" | "translation_summary" | "mind_map" | "mind_map_followup" | "audio_transcription" | "audio_followup";
  /** Per-file segment transcripts from client-orchestrated progressive ASR. */
  audioSegmentResults?: Array<{
    name?: string;
    objectKey?: string;
    segments?: string[];
  }>;
  question?: string;
  translation?: {
    direction?: "zh-en" | "en-zh";
    style?: "natural" | "literal" | "academic" | "conversational";
    requiredTerms?: string;
    preservedTerms?: string;
  };
  translationSummary?: {
    focus?: "comprehensive" | "sentence_patterns" | "vocabulary";
    theme?: string;
    items?: Array<{
      sourceText?: string;
      translation?: string;
      direction?: "zh-en" | "en-zh";
    }>;
  };
  scheduleContext?: unknown;
  accessCode?: string;
  history?: AiAssistantHistoryMessage[];
  attachments?: AiAssistantAttachment[];
  audio?: { name?: string; mimeType?: string; size?: number; dataUrl?: string; objectKey?: string };
  audios?: Array<{ name?: string; mimeType?: string; size?: number; objectKey?: string }>;
  audioLanguage?: "auto" | "zh" | "en";
  summarizeAudio?: boolean;
  mindMapDepth?: MindMapDepth;
  mindMap?: AiMindMapNode;
  document?: {
    documentId?: string;
    name?: string;
    pageCount?: number;
    feature?: "assistant" | "mind_map";
    pages?: Array<{ pageNumber?: number; size?: number; mimeType?: string }>;
    objectKeys?: string[];
    startPage?: number;
    endPage?: number;
    text?: string;
  };
  audioRange?: {
    objectKey?: string;
    fileName?: string;
    language?: "auto" | "zh" | "en";
    chunkIndex?: number;
    chunkCount?: number;
    nominalStart?: number;
    nominalEnd?: number;
    fetchStart?: number;
    fetchEnd?: number;
  };
  /** Optional body fallback when custom headers are stripped by the client runtime. */
  audioRangeSignature?: string;
  audioPart?: {
    objectKey?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    language?: "auto" | "zh" | "en";
    partIndex?: number;
    partCount?: number;
  };
  audioPartSignature?: string;
}

export interface AiAssistantAttachment {
  name?: string;
  mimeType?: string;
  kind?: "image" | "document";
  dataUrl?: string;
  text?: string;
  pageImages?: string[];
  remotePages?: Array<{ objectKey?: string; pageNumber?: number; mimeType?: string; size?: number }>;
  documentId?: string;
  pageCount?: number;
  processedPageCount?: number;
  processingUsage?: AiAssistantUsage;
}

export interface SupabaseUser {
  id: string;
  email?: string;
}

export interface AiAccessRow {
  user_id?: string;
  enabled: boolean;
  role: "member" | "admin";
  expires_at: string | null;
  note?: string | null;
}

export type AnniversaryKind = "anniversary" | "birthday" | "holiday";
export type EventRecurrenceType = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "interval";
export type AiAssistantAction = AiCreateEventAction | AiCreateAnniversaryAction | AiCreateMemoAction | AiUpdateEventAction | AiDeleteEventAction | AiUpdateAnniversaryAction;

export interface AiCreateEventAction {
  type: "create_event";
  eventType?: "event" | "habit";
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  location?: string | null;
  note?: string | null;
  recurrenceType?: EventRecurrenceType;
  recurrenceUntil?: string | null;
  recurrenceInterval?: number;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
}

export interface AiCreateAnniversaryAction {
  type: "create_anniversary";
  title: string;
  kind?: AnniversaryKind;
  date?: string | null;
  calendarType?: "solar" | "lunar";
  lunarYear?: number | null;
  lunarMonth?: number | null;
  lunarDay?: number | null;
  lunarIsLeapMonth?: boolean;
  note?: string | null;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  reminderTime?: string | null;
}

export interface AiCreateMemoAction {
  type: "create_memo";
  title: string;
  content?: string | null;
  isPinned?: boolean;
}

export interface AiUpdateEventAction {
  type: "update_event";
  title: string;
  date?: string | null;
  newTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean | null;
  location?: string | null;
  note?: string | null;
  reminderEnabled?: boolean | null;
  reminderMinutesBefore?: number | null;
}

export interface AiDeleteEventAction {
  type: "delete_event";
  title: string;
  date?: string | null;
}

export interface AiUpdateAnniversaryAction {
  type: "update_anniversary";
  scope?: "title" | "all_lunar_holidays" | "all_holidays";
  title?: string | null;
  newTitle?: string | null;
  kind?: AnniversaryKind | null;
  calendarType?: "solar" | "lunar" | null;
  date?: string | null;
  lunarYear?: number | null;
  lunarMonth?: number | null;
  lunarDay?: number | null;
  lunarIsLeapMonth?: boolean | null;
  reminderEnabled?: boolean | null;
  reminderDaysBefore?: number | null;
  reminderTime?: string | null;
}

export interface AiAssistantResponse {
  answer: string;
  actions: AiAssistantAction[];
  mindMap?: AiMindMapNode;
  model: string;
  usage: AiAssistantUsage;
  processedAttachments?: AiAssistantAttachment[];
  temporaryDocumentKeys?: string[];
}

export interface ParsedAssistantResponse {
  answer: string;
  actions: AiAssistantAction[];
  mindMap?: AiMindMapNode;
}

export interface AiMindMapNode {
  label: string;
  children: AiMindMapNode[];
}

export interface AiAssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiAssistantUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_cny: number | null;
}

export type AiAccessMethod = "access-code" | "ordinary" | "member" | "admin";
export type AiFeatureKey = "assistant" | "translation" | "mind_map" | "audio_transcription";
export type MindMapDepth = "quick" | "standard" | "deep";

export interface AiFeatureQuotaSettings {
  enabled_for_all: boolean;
  ordinary_daily_limit: number;
  ordinary_weekly_limit: number;
  member_daily_limit: number;
  member_weekly_limit: number;
}

export interface AiQuotaSnapshot {
  requests: number;
  totalTokens: number;
  estimatedCostCny: number;
}

export interface AiQuotaLimits {
  daily: number;
  weekly: number;
}

export interface AiQuotaCheck {
  allowed: boolean;
  countsIncludeCurrentRequest?: boolean;
  reason?: string;
  rateLimited?: boolean;
  today?: AiQuotaSnapshot;
  week?: AiQuotaSnapshot;
  limits: AiQuotaLimits;
  usageKnown: boolean;
}

export interface AiPublicQuotaStatus {
  accessMethod: AiAccessMethod;
  accessLabel: string;
  unlimited: boolean;
  usageKnown: boolean;
  currentRequestCounted: boolean;
  daily: { used: number | null; limit: number | null; remaining: number | null };
  weekly: { used: number | null; limit: number | null; remaining: number | null };
}

export interface AiSettingsRow {
  enabled_for_all: boolean;
  ordinary_daily_limit: number;
  ordinary_weekly_limit: number;
  member_daily_limit: number;
  member_weekly_limit: number;
  provider: AiProvider;
  model: string;
  mimo_channel: "payg" | "token_plan";
  audio_provider: AudioProvider;
  audio_model: string;
  text_relay_id?: string | null;
  audio_relay_id?: string | null;
  text_relay?: AiRelayRuntime | null;
  audio_relay?: AiRelayRuntime | null;
  feature_quotas?: Partial<Record<AiFeatureKey, AiFeatureQuotaSettings>>;
}

export type AiProvider = TextProvider;
export type AudioProvider = "mimo" | "siliconflow";
export type AiRelayProtocol = "openai_compatible" | "deepseek" | "mimo";

export interface AiRelayRuntime {
  id: string;
  name: string;
  protocol: AiRelayProtocol;
  base_url: string;
  api_key: string;
  supports_text: boolean;
  text_model: string | null;
  supports_audio: boolean;
  audio_model: string | null;
}

export interface ProviderCredentials {
  apiKey: string;
  endpoint: string;
  provider?: AiProvider | AudioProvider;
  model?: string;
}

export interface UploadedAudioInput {
  name: string;
  mimeType: string;
  size: number;
  objectKey: string;
}

export interface SignedAudioPart extends UploadedAudioInput {
  language: "auto" | "zh" | "en";
  partIndex: number;
  partCount: number;
}

export interface PaidTaskToken {
  expiresAt: string;
  nonce: string;
}

