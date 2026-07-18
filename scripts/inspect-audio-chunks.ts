import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { splitAudioForAsr } from "../supabase/functions/_shared/audioChunking";

for (const filePath of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(filePath));
  const chunks = splitAudioForAsr(bytes, basename(filePath), "audio/mpeg");
  console.log(JSON.stringify({
    file: basename(filePath),
    bytes: bytes.length,
    chunks: chunks.map((chunk, index) => ({
      index: index + 1,
      bytes: chunk.bytes.length,
      durationSeconds: chunk.durationMs == null ? null : Math.round(chunk.durationMs / 1000)
    }))
  }));
}
