import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = required("R2_BUCKET");
const client = new S3Client({
  region: "auto",
  endpoint: required("R2_ENDPOINT"),
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }
});
const prefix = `codex-smoke-source/${Date.now()}`;

for (const [index, filePath] of process.argv.slice(2).entries()) {
  const key = `${prefix}/audio-${index + 1}.mp3`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: statSync(filePath).size,
    ContentType: "audio/mpeg",
    Metadata: { originalName: Buffer.from(basename(filePath)).toString("base64url") }
  }));
  console.log(key);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
