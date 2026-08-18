# Self-hosted reliable service

This backend is for a person or organization running Hot Cross Buns on infrastructure they control. It is not an HCB-operated hosted service. It keeps a Google refresh token, a full PostgreSQL mirror of Calendar and Tasks, opaque browser sessions, and optional Web Push subscriptions; therefore it is an explicit trust boundary controlled by its deployer.

```
PWA + /api on one HTTPS origin you control
                 |
                 v
Fastify API + PostgreSQL + scheduler you operate
                 |
                 v
Google OAuth, Tasks, Calendar, and optional Drive metadata APIs
```

The browser never receives a server OAuth client secret or Google refresh token. Refresh tokens are AES-256-GCM ciphertext with the Google subject as authenticated associated data. Sessions are random opaque values and the database stores only their SHA-256 hashes. The worker polls every connected account at least every five minutes, maintains Calendar sync tokens and a Task `updatedMin` watermark, and uses a PostgreSQL advisory lock to avoid duplicate work when more than one scheduler runs.

## Required configuration

Copy `.env.example` to `.env`. Use Node 22+, PostgreSQL 16+, and HTTPS for every non-development deployment.

```sh
cd backend
npm ci
cp .env.example .env
npm run dev
```

For the reliable worker set:

```dotenv
HCB_PUBLIC_ORIGIN=https://calendar.example.com
HCB_FRONTEND_ORIGINS=https://calendar.example.com
HCB_SESSION_SAME_SITE=lax
HCB_RELIABLE_SYNC_ENABLED=true
HCB_VAPID_SUBJECT=mailto:admin@example.com
HCB_VAPID_PUBLIC_KEY=...
HCB_VAPID_PRIVATE_KEY=...
# Optional; this exact same-origin HTTPS URL permits earlier Calendar sync requests.
HCB_GOOGLE_CALENDAR_WEBHOOK_URL=https://calendar.example.com/api/webhooks/google/calendar
```

Generate an encryption key with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Generate a VAPID key pair with:

```sh
npx web-push generate-vapid-keys
```

Keep the encryption keys, VAPID private key, database, and Google client secret out of source control. `HCB_ENCRYPTION_KEYS` supports key rotation, for example `old:<base64>,primary:<base64>`; retain old keys until every ciphertext using them has been replaced or the affected user reauthorizes.

Configure Google Cloud with a Web OAuth client, Google Tasks API, Google Calendar API, optional Drive metadata API, and OpenID scopes. Its authorized redirect URI must be exactly:

```
${HCB_PUBLIC_ORIGIN}/api/auth/google/callback
```

The PWA must be built with:

```sh
cd web
VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED=true npm run build
```

The browser calls only same-origin `/api/*`. Do not configure a separate browser API origin, CORS allow-list, or a CSP exception for one. A public direct-only build omits this variable and cannot select a self-hosted connection.

## Calendar, Tasks, and reminders

The worker always polls; Google Calendar watch webhooks are an optimization, not a replacement. A public HTTPS callback is necessary for watch channels, so a local deployment normally relies on polling unless its owner deliberately exposes a secure tunnel. Google webhook notifications contain no event body: the worker validates the stored channel/resource/token triple and then runs the normal incremental sync.

Calendar Web Push comes only from Google Calendar `popup` reminders, including calendar defaults when an event uses defaults. All-day events are intentionally excluded because they have no exact trigger time. Task Web Push comes only from HCB's terminal `[HCB-TASK v1]` note marker. It encodes one `HH:mm` local time and IANA time zone; recurring task successors keep that time and use their own due date.

Web Push is best effort. It depends on browser support, permission, the push service, network, and operating-system policy; it cannot guarantee that an alert reaches a device. Unsupported or denied devices continue using foreground reminders while the PWA is open. A device chooses whether push content is generic or title-and-time; the default is title-and-time.

## Run the complete stack

Use [selfhost/README.md](../selfhost/README.md) for the supported deployment. It starts PostgreSQL, API, scheduler, static PWA, and Caddy on one public origin. Keep Fastify and PostgreSQL private to the Compose network, make backups according to your own retention policy, and replace the public legal/privacy page with a policy accurate for the service operator.

## Operational checks

- `GET /api/health` verifies PostgreSQL connectivity.
- `GET /api/reliability/status` is authenticated and exposes only enabled state, latest completed mirror sync, latest safe error, and whether Calendar webhooks are configured.
- The API limits Google proxy traffic to 180 requests per session per minute. Multi-instance deployments should add an equivalent shared limit.
- Logs intentionally omit OAuth codes, access tokens, refresh tokens, sessions, Web Push endpoints, and Google request content.
