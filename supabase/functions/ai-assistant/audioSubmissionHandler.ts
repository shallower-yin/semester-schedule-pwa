import { audioSubmissionTask, executeAudioSubmissionTask } from "../_shared/audioSubmission.ts";
import { jsonResponse, PublicHttpError, type AiAccessCheck, type AiRequestContext } from "./requestContext.ts";
import type {
  AiAccessMethod, AiAssistantRequest, AiFeatureKey, AiQuotaLimits, AiQuotaSnapshot,
  AiSettingsRow, PaidTaskToken, ProviderCredentials, SignedAudioPart, SupabaseUser
} from "./requestTypes.ts";

interface AudioSubmissionServices {
  callServiceRoleRpc<T>(name: string, args: Record<string, unknown>, key: string): Promise<T>;
  checkAiAccess(user: SupabaseUser, authorization: string, accessCode: string | undefined, settings: AiSettingsRow | null, feature: AiFeatureKey): Promise<AiAccessCheck>;
  sanitizeInternalAudioPart(value: AiAssistantRequest["audioPart"], userId: string): SignedAudioPart;
  sanitizeInternalAudioRange(value: AiAssistantRequest["audioRange"], userId: string): NonNullable<AiAssistantRequest["audioRange"]>;
  verifyAudioPartToken(userId: string, part: SignedAudioPart, token: string): Promise<PaidTaskToken | null>;
  verifyAudioRangeToken(userId: string, range: NonNullable<AiAssistantRequest["audioRange"]>, token: string): Promise<PaidTaskToken | null>;
  quotaLimitsFor(method: AiAccessMethod, settings: AiSettingsRow | null, feature: AiFeatureKey): AiQuotaLimits;
  configuredAudioCredentials(settings: AiSettingsRow | null): ProviderCredentials;
  configuredModel(settings: AiSettingsRow | null): string;
  assertGlobalAiBudget(key: string): Promise<void>;
  quotaSnapshot(requests: number): AiQuotaSnapshot;
}

/** Owns whole-submission admission; legacy clients still use per-action reservations. */
export async function withAudioSubmission(
  context: AiRequestContext,
  services: AudioSubmissionServices,
  perform: () => Promise<Response>
): Promise<Response> {
  const { request, body, user, authorization, serviceRoleKey, settings, state } = context;
  if (body.action === "close_audio_submission") {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.audioSubmissionId ?? "")) {
      throw new PublicHttpError("音频提交编号无效。", 400);
    }
    await services.callServiceRoleRpc("close_ai_audio_submission", { p_user_id: user.id, p_submission_id: body.audioSubmissionId }, serviceRoleKey);
    return jsonResponse({ ok: true });
  }
  const task = await audioSubmissionTask(body, user.id);
  if (!task) return await perform();
  state.featureKey = "audio_transcription";
  const access = await services.checkAiAccess(user, authorization, body.accessCode?.trim(), settings, state.featureKey);
  if (!access.allowed) return jsonResponse({ error: access.reason, code: "AI_ACCESS_REQUIRED" }, 403);
  state.accessMethod = access.method ?? "";
  // Validate the existing signed leaf capability before reserving a submission.
  if (body.action === "transcribe_audio_part") {
    const part = services.sanitizeInternalAudioPart(body.audioPart, user.id);
    const token = request.headers.get("x-audio-part-signature") ?? body.audioPartSignature ?? "";
    if (!await services.verifyAudioPartToken(user.id, part, token)) throw new PublicHttpError("音频分段签名无效或已过期。", 403);
  } else if (body.action === "transcribe_audio_range") {
    const range = services.sanitizeInternalAudioRange(body.audioRange, user.id);
    const token = request.headers.get("x-audio-range-signature") ?? body.audioRangeSignature ?? "";
    if (!await services.verifyAudioRangeToken(user.id, range, token)) throw new PublicHttpError("音频分段签名无效或已过期。", 403);
  }
  const method = state.accessMethod as AiAccessMethod;
  const limits = services.quotaLimitsFor(method, settings, state.featureKey);
  if (!services.configuredAudioCredentials(settings).apiKey) throw new PublicHttpError("音频转写服务暂未配置。", 503);
  await services.assertGlobalAiBudget(serviceRoleKey);
  const response = await executeAudioSubmissionTask(task, user.id, state.diagnosticId,
    (name, args) => services.callServiceRoleRpc(name, args, serviceRoleKey), {
      p_access_method: method, p_model: services.configuredModel(settings),
      p_daily_limit: Number.isFinite(limits.daily) ? limits.daily : null,
      p_weekly_limit: Number.isFinite(limits.weekly) ? limits.weekly : null
    }, async (admission) => {
      state.submissionQuota = {
        allowed: true, usageKnown: true, countsIncludeCurrentRequest: true, limits,
        today: services.quotaSnapshot(Number(admission.todayRequests) || 0),
        week: services.quotaSnapshot(Number(admission.weekRequests) || 0)
      };
      return await perform();
    });
  // Replay responses have the same CORS headers as fresh responses.
  return jsonResponse(await response.json(), response.status);
}
