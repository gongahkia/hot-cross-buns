# Hot Cross Buns web PWA

The `web/` directory contains a browser-only Hot Cross Buns application. It is separate from the C++/Qt desktop app; neither build system depends on the other.

## Privacy model

The web app is a static frontend. It has no Hot Cross Buns API, account system, database, analytics backend, client-secret store, or refresh-token store.

Google Tasks, Calendar, and Drive API requests go directly from the browser to Google. The browser keeps a replaceable IndexedDB cache for quick startup, local search, and pending offline edits. OAuth access tokens stay only in page memory and are never written to browser storage. Clearing site data removes the cache and saved non-secret client ID.

## Local development

Use Node.js 22 or newer:

```sh
cd web
npm ci
npm run dev
```

Run the checks with:

```sh
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
```

## Google Cloud setup

Every user supplies their own Google Cloud configuration:

1. Create a project in Google Cloud.
2. Enable Google Tasks API, Google Calendar API, and Google Drive API.
3. Configure the OAuth consent screen and add test users while the project is in Testing.
4. Create an OAuth **Web application** client.
5. Add the deployed site origin, for example `https://your-project.pages.dev`, and the local development origin, for example `http://localhost:5173`, as authorized JavaScript origins.
6. Paste only the Web OAuth client ID into the app. Do not paste a client secret.

The initial connection requests Tasks and Calendar access. Drive access is requested only when the user opens the Drive attachment picker, and is limited to `drive.metadata.readonly`.

Google’s browser token model returns short-lived access tokens. When a token expires, the user clicks a visible reconnect or sync control to authorize another token; the app does not hold a refresh token. See Google’s [token model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Cloudflare Pages deployment

Create a Cloudflare Pages project with `web` as the repository root, `npm run build` as the build command, and `dist` as the output directory. The generated site is fully static, so no Worker, D1 database, KV namespace, cache service, or Cloudflare secret is needed.

After the first production deployment, use that exact HTTPS origin in each user’s Google Cloud OAuth client configuration.
