import webpush from "web-push";

const {
  VITE_SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: anonKey,
  REMINDER_DISPATCHER_TOKEN: dispatcherToken,
  VITE_VAPID_PUBLIC_KEY: vapidPublicKey,
  VAPID_PRIVATE_KEY: vapidPrivateKey,
  APP_URL: appUrl
} = process.env;

const required = {
  VITE_SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: anonKey,
  REMINDER_DISPATCHER_TOKEN: dispatcherToken,
  VITE_VAPID_PUBLIC_KEY: vapidPublicKey,
  VAPID_PRIVATE_KEY: vapidPrivateKey,
  APP_URL: appUrl
};
for (const [name, value] of Object.entries(required)) {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
}

webpush.setVapidDetails(
  "mailto:shallower-yin@users.noreply.github.com",
  vapidPublicKey,
  vapidPrivateKey
);

async function callRpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const rows = await callRpc("claim_due_reminders", { dispatcher_token: dispatcherToken });
if (!Array.isArray(rows) || rows.length === 0) {
  console.log("No due reminders.");
  process.exit(0);
}

const deliveries = new Map();
for (const row of rows) {
  const current = deliveries.get(row.delivery_id) ?? { reminder: row, subscriptions: [] };
  current.subscriptions.push({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth }
  });
  deliveries.set(row.delivery_id, current);
}

for (const [deliveryId, delivery] of deliveries) {
  let delivered = false;
  const errors = [];
  const expiredEndpoints = [];
  const payload = JSON.stringify(buildPayload(delivery.reminder));

  for (const subscription of delivery.subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
      delivered = true;
    } catch (error) {
      const statusCode = Number(error?.statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) expiredEndpoints.push(subscription.endpoint);
      errors.push(`${statusCode || "unknown"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await callRpc("complete_reminder_delivery", {
    dispatcher_token: dispatcherToken,
    target_delivery_id: deliveryId,
    was_successful: delivered,
    failure_message: errors.length ? errors.join(" | ").slice(0, 1000) : null,
    expired_endpoints: expiredEndpoints
  });
  console.log(`${delivery.reminder.title}: ${delivered ? "delivered" : "failed"}`);
}

function buildPayload(row) {
  const sourceType = row.source_type ?? "event";
  const sourceId = row.source_id ?? row.event_id ?? row.anniversary_id ?? "unknown";
  if (sourceType === "anniversary") {
    return {
      title: row.title,
      body: `${anniversaryKindLabel(row.anniversary_kind)} · ${row.occurrence_date}`,
      tag: `anniversary-${sourceId}-${row.occurrence_date}`,
      url: appUrl
    };
  }
  const time = row.start_time ? String(row.start_time).slice(0, 5) : "全天";
  return {
    title: row.title,
    body: `${row.occurrence_date} ${time}`,
    tag: `event-${sourceId}-${row.occurrence_date}`,
    url: appUrl
  };
}

function anniversaryKindLabel(kind) {
  if (kind === "birthday") return "生日";
  if (kind === "holiday") return "节日";
  return "纪念日";
}
