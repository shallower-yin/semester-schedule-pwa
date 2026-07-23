import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  MAX_ASR_AUDIO_CHUNK_BYTES,
  MAX_ASR_AUDIO_CHUNK_DURATION_MS,
  splitAudioForAsr
} from "../supabase/functions/_shared/audioChunking.ts";

for (const filePath of process.argv.slice(2)) {
  const name = basename(filePath);
  const bytes = new Uint8Array(readFileSync(filePath));
  const extension = extname(name).toLowerCase();
  const mimeType = extension === ".mp3"
    ? "audio/mpeg"
    : extension === ".m4a" || extension === ".mp4"
      ? "audio/mp4"
      : extension === ".wav"
        ? "audio/wav"
        : "application/octet-stream";
  const chunks = splitAudioForAsr(bytes, name, mimeType);
  if (!chunks.length) throw new Error(`${name}: no chunks`);
  chunks.forEach((chunk, index) => {
    if (!chunk.bytes.length || chunk.bytes.length > MAX_ASR_AUDIO_CHUNK_BYTES) {
      throw new Error(`${name}: invalid bytes at chunk ${index + 1}`);
    }
    if ((chunk.durationMs ?? 0) <= 0 || (chunk.durationMs ?? 0) > MAX_ASR_AUDIO_CHUNK_DURATION_MS + 1) {
      throw new Error(`${name}: invalid duration at chunk ${index + 1}`);
    }
  });
  const totalDurationMs = chunks.reduce((sum, chunk) => sum + (chunk.durationMs ?? 0), 0);
  console.log(JSON.stringify({
    file: name,
    bytes: bytes.length,
    mimeType: chunks[0].mimeType,
    totalDurationSeconds: Math.round(totalDurationMs / 1000),
    order: chunks.map((_, index) => index + 1),
    chunks: chunks.map((chunk, index) => ({
      index: index + 1,
      bytes: chunk.bytes.length,
      durationSeconds: chunk.durationMs == null ? null : Math.round(chunk.durationMs / 1000)
    }))
  }));
}
