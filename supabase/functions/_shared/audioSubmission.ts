export interface AudioSubmissionFile {
  name: string;
  mimeType: string;
  size: number;
  objectKey: string;
}

export interface AudioSubmission {
  id: string;
  audios: AudioSubmissionFile[];
  language: "auto" | "zh" | "en";
  summarize: boolean;
}

export interface AudioSubmissionTask {
  id: string;
  manifest: Omit<AudioSubmission, "id">;
  key: string;
  fingerprint: string;
}

export class AudioSubmissionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function invalid(): never { throw new AudioSubmissionError("音频提交信息无效，请重新选择文件后开始转写。"); }

/** The client ID is only an idempotency key, never authorization or billing evidence. */
export async function audioSubmissionTask(value: unknown, userId: string): Promise<AudioSubmissionTask | null> {
  const body = record(value);
  if (body.audioSubmission === undefined) return null; // Installed legacy clients retain their existing reservation path.
  const raw = record(body.audioSubmission);
  if (typeof raw.id !== "string" || !UUID.test(raw.id)
    || !Array.isArray(raw.audios) || !raw.audios.length || raw.audios.length > 80
    || !["auto", "zh", "en"].includes(String(raw.language)) || typeof raw.summarize !== "boolean") invalid();
  const audios: AudioSubmissionFile[] = raw.audios.map((item) => {
    const file = record(item);
    if (typeof file.name !== "string" || !file.name.trim() || file.name.length > 300
      || typeof file.mimeType !== "string" || file.mimeType.length > 100
      || typeof file.objectKey !== "string" || !file.objectKey.startsWith(`ai-audio/${userId}/`)
      || !/^ai-audio\/[a-f\d-]+\/[a-f\d-]+\.(?:mp3|wav|flac|m4a|aac|ogg)$/i.test(file.objectKey)
      || !Number.isSafeInteger(file.size) || Number(file.size) <= 0 || Number(file.size) > 100 * 1024 * 1024) invalid();
    return { name: file.name.trim().slice(0, 180), mimeType: file.mimeType.trim().toLowerCase(), size: Number(file.size), objectKey: file.objectKey };
  });
  if (new Set(audios.map((file) => file.objectKey)).size !== audios.length
    || audios.reduce((sum, file) => sum + file.size, 0) > 600 * 1024 * 1024) invalid();
  const manifest: AudioSubmissionTask["manifest"] = {
    audios, language: raw.language as AudioSubmission["language"], summarize: raw.summarize
  };
  const fileFor = (key: unknown) => audios.find((file) => file.objectKey === key) ?? invalid();
  const matchingFiles = () => {
    if (!Array.isArray(body.audios) || !body.audios.length) invalid();
    return body.audios.map((item) => {
      const supplied = record(item);
      const file = fileFor(supplied.objectKey);
      if (typeof supplied.name !== "string" || supplied.name.trim().slice(0, 180) !== file.name
        || typeof supplied.mimeType !== "string" || supplied.mimeType.trim().toLowerCase() !== file.mimeType
        || supplied.size !== file.size) invalid();
      return file;
    });
  };
  let key: string;
  let payload: unknown;
  if (body.action === "transcribe_audio_part") {
    const part = record(body.audioPart);
    const file = fileFor(part.objectKey);
    if (part.fileName !== file.name || part.mimeType !== file.mimeType || part.size !== file.size
      || part.language !== manifest.language || file.size > 7_000_000) invalid();
    key = `file:${file.objectKey}`;
    payload = { file, language: manifest.language, summarize: false };
  } else if (body.action === "transcribe_audio_range") {
    const range = record(body.audioRange);
    const file = fileFor(range.objectKey);
    if (!file.name.toLowerCase().endsWith(".mp3") || file.size <= 7_000_000
      || range.fileName !== file.name || range.language !== manifest.language) invalid();
    for (const name of ["chunkIndex", "chunkCount", "nominalStart", "nominalEnd", "fetchStart", "fetchEnd"]) {
      if (!Number.isSafeInteger(range[name]) || Number(range[name]) < 0) invalid();
    }
    if (Number(range.chunkCount) > 800 || Number(range.chunkIndex) >= Number(range.chunkCount)
      || Number(range.fetchStart) > Number(range.nominalStart) || Number(range.nominalStart) > Number(range.nominalEnd)
      || Number(range.nominalEnd) > Number(range.fetchEnd) || Number(range.fetchEnd) >= file.size) invalid();
    key = `range:${file.objectKey}:${range.chunkIndex}`;
    payload = { file, language: manifest.language, chunkIndex: range.chunkIndex, chunkCount: range.chunkCount,
      nominalStart: range.nominalStart, nominalEnd: range.nominalEnd, fetchStart: range.fetchStart, fetchEnd: range.fetchEnd };
  } else if (body.action === "finalize_audio_transcription") {
    const files = matchingFiles();
    if (files.length !== audios.length || files.some((file, index) => file.objectKey !== audios[index].objectKey)
      || !Array.isArray(body.audioSegmentResults) || body.audioSegmentResults.length !== files.length
      || (body.summarizeAudio === true && !manifest.summarize)) invalid();
    const segments = body.audioSegmentResults.map((item, index) => {
      const part = record(item);
      if (part.objectKey !== files[index].objectKey || !Array.isArray(part.segments) || !part.segments.length
        || part.segments.some((text) => typeof text !== "string" || !text.trim())) invalid();
      return { objectKey: part.objectKey, segments: part.segments };
    });
    if (JSON.stringify(segments).length > 1_000_000) invalid();
    key = "finalize";
    payload = { segments, summarize: body.summarizeAudio === true };
  } else if (body.action === "summarize_audio_transcript") {
    if (!manifest.summarize || typeof body.audioTranscript !== "string" || !body.audioTranscript.trim()
      || body.audioTranscript.length > 1_000_000) invalid();
    key = "summary";
    payload = { transcript: body.audioTranscript.trim() };
  } else if (body.mode === "audio_transcription" && body.action === undefined) {
    const files = matchingFiles();
    if (files.length !== 1 || body.audioLanguage !== manifest.language || body.audio
      || (files[0].name.toLowerCase().endsWith(".mp3") && files[0].size > 7_000_000)
      || (body.summarizeAudio === true && (!manifest.summarize || audios.length !== 1))) invalid();
    key = `file:${files[0].objectKey}`;
    payload = { file: files[0], language: manifest.language, summarize: body.summarizeAudio === true };
  } else {
    invalid();
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  return { id: raw.id, manifest, key, fingerprint: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export type AudioSubmissionAdmission = {
  state: "new" | "success" | "busy" | "expired" | "closed" | "mismatch" | "limited" | "denied" | "missing";
  result?: Record<string, unknown>;
  todayRequests?: number;
  weekRequests?: number;
};

/** Completion is token-fenced by diagnosticId in SQL; a stale request cannot release a newer attempt. */
export async function executeAudioSubmissionTask(
  task: AudioSubmissionTask,
  userId: string,
  diagnosticId: string,
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>,
  quotaArgs: Record<string, unknown>,
  run: (admission: AudioSubmissionAdmission) => Promise<Response>
): Promise<Response> {
  const args = { p_user_id: userId, p_submission_id: task.id, p_task_key: task.key, p_diagnostic_id: diagnosticId };
  const admission = await rpc<AudioSubmissionAdmission>("begin_ai_audio_submission_task", {
    ...args, ...quotaArgs, p_manifest: task.manifest, p_request_hash: task.fingerprint
  });
  if (admission.state === "success" && admission.result) return Response.json(admission.result);
  if (admission.state !== "new") {
    if (admission.state === "busy") throw new AudioSubmissionError("该音频分段正在处理中，请稍后重试。", 409);
    if (admission.state === "denied") throw new AudioSubmissionError("音频转写可用额度已用完。", 429);
    if (admission.state === "limited") throw new AudioSubmissionError("音频处理过于频繁或重试次数已达上限。", 429);
    throw new AudioSubmissionError("音频提交已结束、过期或信息不一致，请重新提交。", 403);
  }
  try {
    const response = await run(admission);
    if (!response.ok) {
      await rpc("finish_ai_audio_submission_task", { ...args, p_result: null });
      return response;
    }
    const result = await response.clone().json();
    await rpc("finish_ai_audio_submission_task", { ...args, p_result: result });
    return response;
  } catch (error) {
    await rpc("finish_ai_audio_submission_task", { ...args, p_result: null }).catch(() => undefined);
    throw error;
  }
}
