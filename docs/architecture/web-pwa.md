# Web PWA architecture

The web product is a static React PWA under `web/`. It is intentionally separate from the C++/Qt desktop application.

## Trust boundary

The browser loads Google Identity Services, obtains a short-lived access token after a user action, and calls Google Tasks, Calendar, Drive, and OpenID user-info endpoints directly over HTTPS. There is no Hot Cross Buns server between the browser and Google.

The user owns the Google Cloud project and creates a Web OAuth client. The application accepts its client ID only. A client secret is not accepted because the static browser application cannot keep it confidential.

## Browser data

IndexedDB holds the non-secret client ID, selected account subject, cached Google entities, local search data, sync state, and a pending offline mutation queue. Data is partitioned by the Google OpenID subject. Access tokens and refresh tokens are not written to IndexedDB, local storage, cookies, service-worker caches, URLs, logs, or diagnostics.

Google remains authoritative. The cache is replaceable and synchronization occurs only while the page is open, online, and has a valid user-authorized access token. Service-worker caching is limited to the application shell and versioned static assets; it never caches Google responses or OAuth data.

## Feature boundary

The PWA supports Tasks, task-shaped notes, Calendar range views and event operations, and Drive metadata attachment selection. Drive file contents are not read or uploaded. Desktop-only platform adapters, background daemons, operating-system reminders, trays, global shortcuts, and secure credential stores remain native-app features.
