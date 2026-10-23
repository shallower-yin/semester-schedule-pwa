import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { audioSubmissionTask, AudioSubmissionError, executeAudioSubmissionTask } from "./audioSubmission.ts";

const user = "11111111-1111-4111-8111-111111111111";
const file = { objectKey: `ai-audio/${user}/22222222-2222-4222-8222-222222222222.wav`, name: "录音.wav", mimeType: "audio/wav", size: 1000 };
const submission = { id: "33333333-3333-4333-8333-333333333333", audios: [file], language: "zh", summarize: true };
const single = { mode: "audio_transcription", audios: [file], audioLanguage: "zh", summarizeAudio: false, audioSubmission: submission };

Deno.test("audio submission binds owner, immutable manifest and paid task payload", async () => {
  assertEquals(await audioSubmissionTask({ mode: "audio_transcription" }, user), null);
  const first = await audioSubmissionTask(single, user);
  const retry = await audioSubmissionTask({ ...single, accessCode: "not-part-of-identity" }, user);
  assertEquals(first, retry);
  assertEquals(first?.key, `file:${file.objectKey}`);
  const paddedFile = { ...file, name: ` ${file.name} `, mimeType: "audio/WAV" };
  const padded = await audioSubmissionTask({ ...single, audios: [paddedFile], audioSubmission: { ...submission, audios: [paddedFile] } }, user);
  assertEquals(padded, first);
  await assertRejects(() => audioSubmissionTask(single, "different-user"), AudioSubmissionError);
  await assertRejects(() => audioSubmissionTask({ ...single, audioLanguage: "en" }, user), AudioSubmissionError);
  await assertRejects(() => audioSubmissionTask({ ...single, audios: [{ ...file, objectKey: file.objectKey.replace("2222", "4444") }] }, user), AudioSubmissionError);
  await assertRejects(() => audioSubmissionTask({ ...single, audioSubmission: { ...submission, audios: [file, file] } }, user), AudioSubmissionError);
  await assertRejects(() => audioSubmissionTask({ ...single, mode: "audio_followup" }, user), AudioSubmissionError);
  const summary = await audioSubmissionTask({ action: "summarize_audio_transcript", audioTranscript: "正文", audioSubmission: submission }, user);
  assertEquals(summary?.key, "summary");
  await assertRejects(() => audioSubmissionTask({ action: "summarize_audio_transcript", audioTranscript: "正文", audioSubmission: { ...submission, summarize: false } }, user), AudioSubmissionError);
});

Deno.test("submission replay bypasses work; denied and in-flight tasks never call provider", async () => {
  const task = (await audioSubmissionTask(single, user))!;
  let calls = 0;
  const run = () => { calls++; return Promise.resolve(Response.json({ transcript: "done" })); };
  const replay = await executeAudioSubmissionTask(task, user, crypto.randomUUID(),
    <T>() => Promise.resolve({ state: "success", result: { transcript: "cached" } } as T), {}, run);
  assertEquals(await replay.json(), { transcript: "cached" });
  for (const state of ["busy", "closed", "mismatch", "expired", "limited", "denied", "missing"]) {
    await assertRejects(() => executeAudioSubmissionTask(task, user, crypto.randomUUID(),
      <T>() => Promise.resolve({ state } as T), {}, run), AudioSubmissionError);
  }
  assertEquals(calls, 0);
});

Deno.test("submission failure releases only its task lease and success persists replay result", async () => {
  const task = (await audioSubmissionTask(single, user))!;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve({ state: "new", todayRequests: 1, weekRequests: 1 } as T);
  };
  const diagnosticId = crypto.randomUUID();
  await assertRejects(() => executeAudioSubmissionTask(task, user, diagnosticId, rpc, {}, () => { throw new Error("provider failure"); }), Error, "provider failure");
  assertEquals(calls.at(-1), { name: "finish_ai_audio_submission_task", args: {
    p_user_id: user, p_submission_id: submission.id, p_task_key: task.key, p_diagnostic_id: diagnosticId, p_result: null
  } });
  await executeAudioSubmissionTask(task, user, diagnosticId, rpc, {}, () => Promise.resolve(Response.json({ transcript: "done" })));
  assertEquals(calls.at(-1)?.args.p_result, { transcript: "done" });
});
