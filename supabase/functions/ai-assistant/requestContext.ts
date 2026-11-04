import type {
  AiAccessMethod, AiAssistantRequest, AiAssistantUsage, AiFeatureKey, AiQuotaCheck,
  AiSettingsRow, SupabaseUser
} from "./requestTypes.ts";

/** Mutable accounting/diagnostics belong to one request, never a module singleton. */
export interface AiRequestState {
  readonly startedAt: number;
  readonly diagnosticId: string;
  currentUser: SupabaseUser | null;
  accessMethod: string;
  questionChars: number;
  featureKey: AiFeatureKey;
  observedUsage: AiAssistantUsage;
  submissionQuota?: AiQuotaCheck;
}

/** Authenticated inputs are fixed; handlers update only the explicit request state. */
export interface AiRequestContext {
  readonly request: Request;
  readonly body: AiAssistantRequest;
  readonly user: SupabaseUser;
  readonly authorization: string;
  readonly serviceRoleKey: string;
  readonly settings: AiSettingsRow | null;
  readonly state: AiRequestState;
}

export interface AiAccessCheck {
  allowed: boolean;
  method?: AiAccessMethod;
  reason?: string;
  bound?: boolean;
}

export interface AiUsageLogInput {
  userId: string;
  status: "running" | "success" | "error";
  accessMethod: string;
  featureKey: AiFeatureKey;
  model: string;
  usage: AiAssistantUsage;
  latencyMs: number;
  questionChars: number;
  error?: string;
  diagnosticId?: string;
  diagnosticDetails?: Record<string, unknown>;
}

export function createRequestState(): AiRequestState {
  return {
    startedAt: Date.now(), diagnosticId: crypto.randomUUID(), currentUser: null,
    accessMethod: "", questionChars: 0, featureKey: "assistant", observedUsage: emptyUsage()
  };
}

export function emptyUsage(): AiAssistantUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_cny: null };
}

export class DiagnosticError extends Error {
  constructor(message: string, readonly details: Record<string, unknown>) {
    super(message);
    this.name = "DiagnosticError";
  }
}

export class PublicHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PublicHttpError";
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-audio-range-signature, x-audio-part-signature",
      "access-control-allow-methods": "POST, OPTIONS"
    }
  });
}
