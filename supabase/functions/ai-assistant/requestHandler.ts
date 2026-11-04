import { AudioSubmissionError } from "../_shared/audioSubmission.ts";
import { readAiRequest } from "./requestValidation.ts";
import { createRequestState, DiagnosticError, jsonResponse, PublicHttpError, type AiRequestContext, type AiUsageLogInput } from "./requestContext.ts";
import type { AiAssistantUsage, AiSettingsRow, SupabaseUser } from "./requestTypes.ts";

interface RequestServices {
  serviceRoleSecret(): string;
  getAiSettings(serviceRoleKey: string): Promise<AiSettingsRow | null>;
  getUser(authorization: string): Promise<SupabaseUser>;
  dispatch(context: AiRequestContext): Promise<Response>;
  combineUsage(left: AiAssistantUsage, right: AiAssistantUsage): AiAssistantUsage;
  usageFromDiagnosticDetails(details: Record<string, unknown>): AiAssistantUsage;
  logAiAssistantUsage(input: AiUsageLogInput): Promise<void>;
}

/** HTTP/authentication/error boundary, independently testable without starting a server. */
export function createAiRequestHandler(services: RequestServices) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return jsonResponse({ ok: true });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const state = createRequestState();
    try {
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "请先登录后再使用 AI 助手。" }, 401);
      const body = await readAiRequest(request);
      const serviceRoleKey = services.serviceRoleSecret();
      const settings = serviceRoleKey ? await services.getAiSettings(serviceRoleKey) : null;
      const user = await services.getUser(authorization);
      state.currentUser = user;
      return await services.dispatch({ request, body, user, authorization, serviceRoleKey, settings, state });
    } catch (error) {
      const diagnosticDetails = error instanceof DiagnosticError ? error.details : {};
      const failureUsage = services.combineUsage(state.observedUsage, services.usageFromDiagnosticDetails(diagnosticDetails));
      const publicMessage = error instanceof Error ? error.message : "AI 助手请求失败。";
      console.error("AI request failed", { diagnosticId: state.diagnosticId, featureKey: state.featureKey, message: publicMessage, ...diagnosticDetails });
      if (state.currentUser) {
        await services.logAiAssistantUsage({
          userId: state.currentUser.id, status: "error", accessMethod: state.accessMethod,
          featureKey: state.featureKey, model: "configured-provider", usage: failureUsage,
          latencyMs: Date.now() - state.startedAt, questionChars: state.questionChars,
          error: publicMessage, diagnosticId: state.diagnosticId, diagnosticDetails
        });
      }
      const status = error instanceof PublicHttpError || error instanceof AudioSubmissionError ? error.status : 500;
      return jsonResponse({
        error: `${publicMessage}（诊断编号：${state.diagnosticId.slice(0, 8)}）`,
        diagnosticId: state.diagnosticId
      }, status);
    }
  };
}
