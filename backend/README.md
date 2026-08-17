# Managed Hot Cross Buns service

This optional service gives the web PWA a long-lived Google connection. It is self-hosted: deploy it only when the operator is willing to run PostgreSQL and hold the Google OAuth client secret and credential-encryption keys.

```
PWA in the user's browser
       |  HttpOnly opaque session cookie
       v
Managed HCB API + PostgreSQL
       |  decrypts refresh token only to mint a short-lived access token
       v
Google OAuth, Tasks, Calendar, Drive metadata APIs
```

The browser never receives the server OAuth client secret or a Google refresh token. The service stores refresh tokens as AES-256-GCM ciphertext, with the Google subject as authenticated associated data. Sessions are random opaque values; only SHA-256 hashes are stored in PostgreSQL. The service proxies only the Google Tasks, Calendar, and Drive-file-metadata routes used by this PWA.

This is not zero-knowledge storage. The person operating the service and holding its database plus encryption keys can access stored refresh tokens. Use a separate secret manager for the encryption key material and restrict database access accordingly.

## Required configuration

Copy `.env.example` to `.env` and set every placeholder. The server requires Node 22 or newer and PostgreSQL 16 or newer.

```sh
cd backend
npm ci
cp .env.example .env
npm run dev
```

For a production build:

```sh
npm ci
npm run build
NODE_ENV=production node dist/index.js
```

The startup migration creates only the four `managed_*` tables. It does not create a database or PostgreSQL role.

Configure Google Cloud with a **Web application** OAuth client. Enable Google Tasks API, Google Calendar API, Google Drive API, and the OpenID scopes used by the consent screen. Its authorized redirect URI must be exactly:

```
${HCB_PUBLIC_ORIGIN}/api/auth/google/callback
```

For local development using the example configuration, that is `http://127.0.0.1:8787/api/auth/google/callback`. Do not place the client secret in the PWA or in a `VITE_` environment variable.

Build the PWA with the service URL:

```sh
cd web
VITE_HCB_BACKEND_URL=http://127.0.0.1:8787 npm run build
```

The URL is compiled into the PWA. An installation can instead omit `VITE_HCB_BACKEND_URL` and continue using the direct browser OAuth mode. The PWA lets a user choose either mode; its browser-local cache is unaffected when switching.

## Production topology and cookies

Use HTTPS in production. A same-site deployment such as `https://app.example.com` and `https://api.example.com` is recommended:

```dotenv
HCB_PUBLIC_ORIGIN=https://api.example.com
HCB_FRONTEND_ORIGINS=https://app.example.com
HCB_SESSION_SAME_SITE=lax
```

`HCB_FRONTEND_ORIGINS` is an exact, comma-separated allow-list. It controls CORS and is also checked on every state-changing browser request. If the PWA and API must be on unrelated sites, set `HCB_SESSION_SAME_SITE=none`; this requires HTTPS and may be blocked by browsers or privacy policies that reject third-party cookies.

The session cookie is `HttpOnly`, `Secure` on HTTPS, and `SameSite=Lax` by default. Its expiry is renewed while the PWA uses the service; a configured `HCB_SESSION_TTL_DAYS` is therefore an inactivity timeout, not a forced sign-in interval. A user can explicitly disconnect from Settings, which deletes the stored credential and server sessions, then asks Google to revoke the refresh token.

## Encryption-key operations

Generate a new 32-byte key with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

`HCB_ENCRYPTION_KEYS` accepts a keyring, for example `old:<base64>,primary:<base64>`. Set `HCB_ACTIVE_ENCRYPTION_KEY_ID=primary` so newly stored refresh tokens use the new key. Retain every old key until every credential encrypted by it has been reauthorized; removing a key earlier makes that credential unusable and the user must reconnect Google. Keep keys outside the database, ideally in a managed secret store, and rotate database backups independently.

## Container deployment

`Dockerfile` builds a Node 22 production image. `../docker-compose.managed.yml` is a local/self-hosting starter; it reads service secrets from `backend/.env` and PostgreSQL credentials from the shell environment:

Before running Compose, set `DATABASE_URL` in `backend/.env` to use the Compose service host, for example `postgres://hot_cross_buns:choose-a-long-password@postgres:5432/hot_cross_buns`.

```sh
POSTGRES_USER=hot_cross_buns POSTGRES_PASSWORD='choose-a-long-password' POSTGRES_DB=hot_cross_buns \
  docker compose -f docker-compose.managed.yml up --build
```

For an internet-facing service, terminate TLS in a reverse proxy, do not publish PostgreSQL, use a managed PostgreSQL backup policy, and make `/api/health` available only to the platform health checker if public service discovery is undesirable.

## Operational checks

- `GET /api/health` verifies the process can query PostgreSQL and returns `{"service":"available"}`.
- The PWA Health & logs page checks this endpoint in managed mode and reports session/sync/storage issues without exposing credentials or Google content.
- Server logs deliberately record error class and status rather than OAuth codes, access tokens, refresh tokens, session cookies, or Google request content.
- The API applies a per-user in-memory Google proxy limit of 180 requests per minute. In a multi-instance deployment, enforce an equivalent shared limit at the reverse proxy or application platform.
