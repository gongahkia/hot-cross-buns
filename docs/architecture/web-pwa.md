# Web PWA architecture

The web product is a static React PWA under `web/`. It is intentionally separate from the C++/Qt desktop application.

## Connection models and trust boundary

The PWA supports two explicit, mutually exclusive Google connection models.

### Direct browser OAuth (advanced alternative)

The browser loads Google Identity Services, obtains a short-lived access token after a user action, and calls Google Tasks, Calendar, Drive, and OpenID user-info endpoints directly over HTTPS. There is no Hot Cross Buns server between the browser and Google.

The user owns the Google Cloud project and creates a Web OAuth client. The application accepts its client ID only. A client secret is not accepted because the static browser application cannot keep it confidential.

### Self-hosted reliable service (optional)

When a user deploys the full stack with `VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED=true`, the PWA can offer the self-hosted reliable service. The PWA and Fastify API share exactly one HTTPS origin; Caddy serves the static app and forwards `/api/*` to the private API container. The service uses authorization-code OAuth with PKCE, stores the Google refresh token encrypted with AES-256-GCM in the deployer's PostgreSQL database, and gives the browser an opaque `HttpOnly` session cookie. It exchanges the refresh token for short-lived access tokens server-side and proxies only the restricted Google API paths the PWA needs.

The self-hosted service is an additional trust boundary: its deployer can recover refresh tokens when they possess both the database and encryption key. Hot Cross Buns does not operate it. It must therefore be deployed over HTTPS, use a separate secret manager for its keyring, constrain `HCB_FRONTEND_ORIGINS` to the app origin, and keep Fastify and PostgreSQL private behind the reverse proxy. The scheduler polls Calendar and Tasks at least every five minutes, uses validated Calendar watch notifications only to request earlier sync, and sends best-effort standards Web Push from Calendar popup reminders and explicit task reminder markers. `selfhost/README.md` and `backend/README.md` contain deployment and security requirements.

## Browser data

IndexedDB holds the non-secret client ID, selected connection mode, selected account subject, cached Google entities, local search data, sync state, and a pending offline mutation queue. Data is partitioned by the Google OpenID subject. Access tokens and refresh tokens are not written to IndexedDB, local storage, service-worker caches, URLs, logs, or diagnostics. In self-hosted mode, the browser has only an `HttpOnly` opaque session cookie; it cannot read a Google refresh token.

Google remains authoritative. The browser cache is replaceable. Direct mode synchronization occurs only while the page is open and online and additionally requires a valid user-authorized browser access token. Self-hosted mode refreshes Google access server-side while its rolling server session remains active; its server-side mirror runs independently of the browser. Service-worker caching is limited to the application shell and versioned static assets; it never caches Google responses or OAuth data.

## Feature boundary

The PWA supports Tasks, task-shaped notes, Calendar range views and event operations, and Drive metadata attachment selection. Drive file contents are not read or uploaded. Desktop-only platform adapters, background daemons, operating-system reminders, trays, global shortcuts, and secure credential stores remain native-app features.
