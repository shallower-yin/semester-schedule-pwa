// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "npm:web-push@3.6.7";

interface ReminderRow {
  delivery_id: string;
  event_id: string;
  title: string;
  occurrence_date: string;
  start_time: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface Delivery {
  event: ReminderRow;
  subscriptions: webpush.PushSubscription[];
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

const supabaseUrl = requiredSecret("SUPABASE_URL");
const publishableKeys = JSON.parse(requiredSecret("SUPABASE_PUBLISHABLE_KEYS")) as Record<string, string>;
const publishableKey = publishableKeys.default;
if (!publishableKey) throw new Error("Missing default Supabase publishable key");
const dispatcherToken = requiredSecret("REMINDER_DISPATCHER_TOKEN");
const vapidPublicKey = requiredSecret("VAPID_PUBLIC_KEY");
const vapidPrivateKey = requiredSecret("VAPID_PRIVATE_KEY");
const appUrl = requiredSecret("APP_URL");

webpush.setVapidDetails(
  "mailto:shallower-yin@users.noreply.github.com",
  vapidPublicKey,
  vapidPrivateKey
);

async function callRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (request.headers.get("apikey") !== publishableKey) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const rows = await callRpc<ReminderRow[]>("claim_due_reminders", {
      dispatcher_token: dispatcherToken
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ claimed: 0, delivered: 0, failed: 0 });
    }

    const deliveries = new Map<string, Delivery>();
    for (const row of rows) {
      const current = deliveries.get(row.delivery_id) ?? { event: row, subscriptions: [] };
      current.subscriptions.push({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      });
      deliveries.set(row.delivery_id, current);
    }

    let deliveredCount = 0;
    let failedCount = 0;
    for (const [deliveryId, delivery] of deliveries) {
      let delivered = false;
      const errors: string[] = [];
      const expiredEndpoints: string[] = [];
      const time = delivery.event.start_time
        ? String(delivery.event.start_time).slice(0, 5)
        : "全天";
      const payload = JSON.stringify({
        title: delivery.event.title,
        body: `${delivery.event.occurrence_date} ${time}`,
        tag: `event-${delivery.event.event_id}-${delivery.event.occurrence_date}`,
        url: appUrl
      });

      for (const subscription of delivery.subscriptions) {
        try {
          await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
          delivered = true;
        } catch (error) {
          const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            expiredEndpoints.push(subscription.endpoint);
          }
          errors.push(`${statusCode || "unknown"}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await callRpc<null>("complete_reminder_delivery", {
        dispatcher_token: dispatcherToken,
        target_delivery_id: deliveryId,
        was_successful: delivered,
        failure_message: errors.length ? errors.join(" | ").slice(0, 1000) : null,
        expired_endpoints: expiredEndpoints
      });
      if (delivered) deliveredCount += 1;
      else failedCount += 1;
    }

    return jsonResponse({
      claimed: deliveries.size,
      delivered: deliveredCount,
      failed: failedCount
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
