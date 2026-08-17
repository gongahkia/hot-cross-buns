# Web PWA architecture

The web product is a static React PWA under `web/`. It is intentionally separate from the C++/Qt desktop application.

## Connection models and trust boundary

The PWA supports two explicit, mutually exclusive Google connection models.

### Direct browser OAuth (default)

The browser loads Google Identity Services, obtains a short-lived access token after a user action, and calls Google Tasks, Calendar, Drive, and OpenID user-info endpoints directly over HTTPS. There is no Hot Cross Buns server between the browser and Google.

The user owns the Google Cloud project and creates a Web OAuth client. The application accepts its client ID only. A client secret is not accepted because the static browser application cannot keep it confidential.

### Optional managed OAuth service

When the PWA build contains `VITE_HCB_BACKEND_URL`, a user can instead choose a self-hosted managed service under `backend/`. That service uses the OAuth authorization-code flow with PKCE, stores the Google refresh token encrypted with AES-256-GCM in PostgreSQL, and gives the browser an opaque `HttpOnly` session cookie. It exchanges the refresh token for short-lived access tokens server-side and proxies only the restricted Google API paths the PWA needs.

The managed service is an additional trust boundary: its operator can recover refresh tokens when they possess both the database and encryption key. It must therefore be deployed over HTTPS, use a separate secret manager for its keyring, and constrain `HCB_FRONTEND_ORIGINS` to known PWA origins. `backend/README.md` contains setup, cookie, key-rotation, and deployment requirements.

## Browser data

IndexedDB holds the non-secret client ID, selected connection mode, selected account subject, cached Google entities, local search data, sync state, and a pending offline mutation queue. Data is partitioned by the Google OpenID subject. Access tokens and refresh tokens are not written to IndexedDB, local storage, service-worker caches, URLs, logs, or diagnostics. In managed mode, the browser has only an `HttpOnly` opaque session cookie; it cannot read a Google refresh token.

Google remains authoritative. The cache is replaceable and synchronization occurs only while the page is open and online. Direct mode additionally requires a valid user-authorized browser access token. Managed mode refreshes Google access server-side while its rolling server session remains active. Service-worker caching is limited to the application shell and versioned static assets; it never caches Google responses or OAuth data.

## Feature boundary

The PWA supports Tasks, task-shaped notes, Calendar range views and event operations, and Drive metadata attachment selection. Drive file contents are not read or uploaded. Desktop-only platform adapters, background daemons, operating-system reminders, trays, global shortcuts, and secure credential stores remain native-app features.
