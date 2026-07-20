import {
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client
} from "@aws-sdk/client-s3";

const endpoint = required("R2_ENDPOINT");
const bucket = required("R2_BUCKET");
const accessKeyId = required("R2_ACCESS_KEY_ID");
const secretAccessKey = required("R2_SECRET_ACCESS_KEY");

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey }
});

const failures = [];
await configure("CORS", new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedHeaders: ["content-type"],
      AllowedMethods: ["GET", "HEAD", "PUT"],
      AllowedOrigins: [
        "https://shallower-yin.github.io",
        // Capacitor Android WebView serves the app from https://localhost; iOS uses capacitor://localhost.
        // Without these, direct R2 uploads (audio transcription, long PDF) fail in the APK with a CORS
        // "Failed to fetch" even though they work in the browser PWA.
        "https://localhost",
        "capacitor://localhost",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://localhost:5173"
      ],
      ExposeHeaders: ["etag"],
      MaxAgeSeconds: 3600
    }]
  }
}));
await configure("lifecycle", new PutBucketLifecycleConfigurationCommand({
  Bucket: bucket,
  LifecycleConfiguration: {
    Rules: [
      {
        ID: "delete-abandoned-ai-audio",
        Status: "Enabled",
        Filter: { Prefix: "ai-audio/" },
        Expiration: { Days: 1 }
      },
      {
        ID: "delete-abandoned-ai-documents",
        Status: "Enabled",
        Filter: { Prefix: "ai-documents/" },
        Expiration: { Days: 1 }
      }
    ]
  }
}));

if (failures.length) throw new Error(`R2 bucket management failed: ${failures.join(", ")}`);

console.log(`R2 bucket "${bucket}" is reachable; browser + APK WebView CORS and one-day temporary AI file cleanup are configured.`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function configure(label, command) {
  try {
    await client.send(command);
  } catch (error) {
    failures.push(`${label} ${error?.name ?? "error"} (${error?.$metadata?.httpStatusCode ?? "unknown"})`);
  }
}
