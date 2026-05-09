/**
 * focus-forecast-push — Cloudflare Worker
 *
 * Handles:
 *   POST /subscribe        — store a PushSubscription in KV
 *   POST /unsubscribe      — delete a subscription from KV
 *   POST /schedule         — store a pending notification in KV
 *   GET  /vapid-public-key — return VAPID public key for frontend
 *   OPTIONS *              — CORS preflight
 *
 *   Cron (every minute)   — scan pending:* keys and fire due notifications
 *
 * NOTE on Web Push encryption:
 *   Actual payload delivery requires aes128gcm encryption per RFC 8291 plus
 *   a VAPID JWT (RFC 8292). This is non-trivial in a Workers runtime without
 *   npm. The `sendPushNotification` function below is a STUB — it logs intent
 *   but does not encrypt or deliver. Before deploying for real, replace it
 *   with a proper implementation. Good reference:
 *     https://github.com/web-push-libs/webpush-java (algorithm spec)
 *     https://developers.cloudflare.com/workers/examples/web-push/  (if available)
 *   Or proxy the encrypted request through a small Node.js lambda that uses
 *   the `web-push` npm package.
 */

const ALLOWED_ORIGIN = "https://sachinai1981-web.github.io";

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function preflight(request) {
  const origin = request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function jsonResponse(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /subscribe
 * Body: { subscription: PushSubscription }
 * Stores the subscription in KV keyed by endpoint URL.
 */
async function handleSubscribe(request, env) {
  const origin = request.headers.get("Origin") || "";
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const sub = body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) {
    return jsonResponse(
      { error: "Missing subscription.endpoint or subscription.keys" },
      400,
      origin
    );
  }

  const record = {
    sub,
    createdAt: Date.now(),
  };

  // Endpoint URLs can be long — use them directly as KV keys (max 512 bytes).
  // For very long endpoints, a hash key would be safer, but this is sufficient
  // for Pomodoro-scale usage.
  await env.SUBS.put(sub.endpoint, JSON.stringify(record));

  return jsonResponse({ ok: true }, 200, origin);
}

/**
 * POST /unsubscribe
 * Body: { endpoint: string }
 * Removes a subscription from KV.
 */
async function handleUnsubscribe(request, env) {
  const origin = request.headers.get("Origin") || "";
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const { endpoint } = body;
  if (!endpoint) {
    return jsonResponse({ error: "Missing endpoint" }, 400, origin);
  }

  await env.SUBS.delete(endpoint);
  return jsonResponse({ ok: true }, 200, origin);
}

/**
 * POST /schedule
 * Body: { endpoint, fireAt: ISOString, title, body, tag }
 * Stores a pending notification in KV under key `pending:<fireAtMs>:<random>`.
 */
async function handleSchedule(request, env) {
  const origin = request.headers.get("Origin") || "";
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const { endpoint, fireAt, title, body: notifBody, tag } = body;

  if (!endpoint || !fireAt || !title) {
    return jsonResponse(
      { error: "Missing required fields: endpoint, fireAt, title" },
      400,
      origin
    );
  }

  const fireAtMs = new Date(fireAt).getTime();
  if (isNaN(fireAtMs)) {
    return jsonResponse({ error: "Invalid fireAt date" }, 400, origin);
  }

  const random = Math.random().toString(36).slice(2, 10);
  const key = `pending:${fireAtMs}:${random}`;

  const payload = {
    endpoint,
    fireAtMs,
    title,
    body: notifBody || "",
    tag: tag || "focus-forecast",
    scheduledAt: Date.now(),
  };

  // TTL: keep pending entries for at most 24 hours past their fire time.
  const ttlSeconds = Math.max(
    60,
    Math.floor((fireAtMs - Date.now()) / 1000) + 86400
  );
  await env.SUBS.put(key, JSON.stringify(payload), { expirationTtl: ttlSeconds });

  return jsonResponse({ ok: true, key }, 200, origin);
}

/**
 * GET /vapid-public-key
 * Returns the VAPID public key so the frontend can subscribe with it.
 */
function handleVapidPublicKey(request, env) {
  const origin = request.headers.get("Origin") || "";
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) {
    return jsonResponse({ error: "VAPID_PUBLIC_KEY not configured" }, 500, origin);
  }
  return jsonResponse({ publicKey: key }, 200, origin);
}

// ---------------------------------------------------------------------------
// Web Push stub
// ---------------------------------------------------------------------------

/**
 * TODO: Replace this stub with real Web Push delivery before deploying.
 *
 * Real implementation requires:
 *   1. Build a VAPID JWT signed with VAPID_PRIVATE_KEY (ES256, crypto.subtle).
 *   2. Encrypt the notification payload with aes128gcm (RFC 8291) using the
 *      subscription's p256dh public key and auth secret.
 *   3. POST to sub.endpoint with the encrypted body and Authorization header.
 *
 * Reference implementations:
 *   - web-push npm package (Node.js): https://github.com/web-push-libs/web-push
 *   - Manual crypto.subtle approach: RFC 8291 + RFC 8292
 */
async function sendPushNotification(sub, payload, env) {
  // STUB — logs intent only. Does not deliver the notification.
  console.log(
    `[stub] would push to ${sub.endpoint} — title: "${payload.title}" body: "${payload.body}"`
  );
  // When real: build VAPID JWT, encrypt payload, fetch(sub.endpoint, {...})
  return { stubbed: true };
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

/**
 * scheduled — fires every minute (see wrangler.toml crons).
 * Lists all `pending:*` keys, fires those whose fireAtMs <= now, then deletes them.
 */
async function handleScheduled(event, env) {
  const now = Date.now();

  // KV list returns up to 1000 keys per call; for high volume add pagination.
  const listed = await env.SUBS.list({ prefix: "pending:" });

  for (const { name: key } of listed.keys) {
    // Key format: pending:<fireAtMs>:<random>
    const parts = key.split(":");
    const fireAtMs = parseInt(parts[1], 10);

    if (isNaN(fireAtMs) || fireAtMs > now) {
      // Not yet due — skip.
      continue;
    }

    const raw = await env.SUBS.get(key);
    if (!raw) continue;

    let pending;
    try {
      pending = JSON.parse(raw);
    } catch {
      console.error(`[cron] failed to parse key ${key} — deleting`);
      await env.SUBS.delete(key);
      continue;
    }

    // Look up the stored subscription record for this endpoint.
    const subRaw = await env.SUBS.get(pending.endpoint);
    if (!subRaw) {
      console.warn(`[cron] no subscription found for ${pending.endpoint} — skipping`);
      await env.SUBS.delete(key);
      continue;
    }

    let record;
    try {
      record = JSON.parse(subRaw);
    } catch {
      console.error(`[cron] bad subscription record for ${pending.endpoint}`);
      await env.SUBS.delete(key);
      continue;
    }

    // Attempt delivery (stubbed until real encryption is implemented).
    try {
      await sendPushNotification(record.sub, pending, env);
    } catch (err) {
      console.error(`[cron] push failed for ${pending.endpoint}:`, err);
    }

    // Always delete the pending entry after attempting delivery.
    await env.SUBS.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const path = url.pathname;

    if (method === "OPTIONS") {
      return preflight(request);
    }

    if (method === "POST" && path === "/subscribe") {
      return handleSubscribe(request, env);
    }

    if (method === "POST" && path === "/unsubscribe") {
      return handleUnsubscribe(request, env);
    }

    if (method === "POST" && path === "/schedule") {
      return handleSchedule(request, env);
    }

    if (method === "GET" && path === "/vapid-public-key") {
      return handleVapidPublicKey(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
