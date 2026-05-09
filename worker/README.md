# focus-forecast-push — Cloudflare Worker

Web Push backend for the Focus Forecast PWA. Stores push subscriptions in
Cloudflare KV and fires scheduled notifications via a Cron Trigger.

## What It Does

| Route | Purpose |
|---|---|
| `GET  /vapid-public-key` | Returns the VAPID public key for the frontend |
| `POST /subscribe` | Saves a `PushSubscription` object in KV |
| `POST /unsubscribe` | Removes a subscription from KV |
| `POST /schedule` | Stores a pending notification (`fireAt`, `title`, `body`) in KV |
| Cron (every minute) | Scans `pending:*` keys and fires due notifications |

## Known Gap

Web Push payload encryption (`aes128gcm`, RFC 8291) and VAPID JWT signing
(RFC 8292) are **stubbed** in `src/worker.js`. The cron handler logs intent
but does not deliver notifications until you replace the `sendPushNotification`
stub with a real implementation. See the TODO comment in `src/worker.js` for
the algorithm references before deploying.

---

## Setup Steps

### 1. Install Wrangler

```bash
npm install -g wrangler
```

### 2. Authenticate

```bash
wrangler login
```

### 3. Create the KV Namespace

```bash
wrangler kv:namespace create SUBS
```

Copy the `id` value from the output and replace `REPLACE_WITH_KV_ID` in
`wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SUBS"
id = "paste-real-id-here"
```

### 4. Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

This prints a public key and a private key.

### 5. Store VAPID Keys as Secrets

```bash
wrangler secret put VAPID_PUBLIC_KEY
# paste the public key when prompted

wrangler secret put VAPID_PRIVATE_KEY
# paste the private key when prompted
```

Secrets are encrypted at rest and injected into `env` at runtime. Never
commit them to source control.

### 6. Deploy

```bash
wrangler deploy
```

---

## Deployed URL

After deploy, your Worker is available at:

```
https://focus-forecast-push.<your-account-subdomain>.workers.dev
```

Find your subdomain in the Cloudflare dashboard under Workers & Pages.

---

## Frontend Integration

In the PWA's `app.js`, after `Notification.requestPermission()` is granted:

```js
const WORKER_BASE = "https://focus-forecast-push.<account>.workers.dev";

// 1. Fetch the VAPID public key
const { publicKey } = await fetch(`${WORKER_BASE}/vapid-public-key`)
  .then(r => r.json());

// 2. Subscribe via the service worker
const sub = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey),
});

// 3. Send subscription to backend
await fetch(`${WORKER_BASE}/subscribe`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ subscription: sub }),
});

// 4. Schedule a notification when a Pomodoro ends
await fetch(`${WORKER_BASE}/schedule`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    endpoint: sub.endpoint,
    fireAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(), // 25 min from now
    title: "Focus session complete",
    body: "Time to take a break.",
    tag: "pomodoro-done",
  }),
});
```

The `urlBase64ToUint8Array` helper converts the base64url-encoded VAPID key
to the `Uint8Array` that `pushManager.subscribe` expects — copy a standard
implementation from MDN or any web-push tutorial.

---

## File Structure

```
worker/
├── wrangler.toml       # Worker config, KV binding, cron schedule
├── src/
│   └── worker.js       # All Worker logic (fetch + scheduled handlers)
├── .gitignore
└── README.md
```
