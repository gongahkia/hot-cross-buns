# Browser deployment

Hot Cross Buns is a static Vite application. `corepack pnpm install --frozen-lockfile` followed by `corepack pnpm build` produces `dist/`. Serve the whole directory over HTTPS, including the hashed worker and SQLite WASM assets. No Node server, Electron runtime, API backend, or server database is required. Local development uses `corepack pnpm dev`; production preview uses `corepack pnpm preview`.

## Vercel

The repository's `vercel.json` specifies the install/build commands, `dist` output, SPA fallback, immutable hashed assets, and revalidation for the service worker, registration script, and HTML. Import this repository in Vercel, select its root directory, and deploy. The checked-in configuration supplies the build settings. Keep the same production hostname: browser workspaces are origin-specific and are not automatically transferred to a preview deployment or another hostname.

Using the planner requires a linked Google account, including for older local-only workspaces. Create a Google Cloud **Web application** OAuth client and add the exact production origin to its authorized JavaScript origins. Add localhost separately for development. Enable the Google Tasks and Calendar APIs and configure the consent screen, including test users while the project is in testing. [Google's setup instructions](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) describe the required client and origin registration.

The client ID is editable in onboarding under **Google sign-in configuration** and later in **Settings → Accounts**. Paste the ID, choose **Save client ID**, then **Connect Google**. The form displays the current origin for copying into Google Cloud. Saving never opens a popup automatically: the separate Connect action preserves the browser's user-gesture requirement. [Google's token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) describes this flow.

The saved public ID takes precedence over the optional `VITE_GOOGLE_CLIENT_ID` build-time default. It persists in `localStorage` under `hcb.google.webClientId`, applies to tabs of the same origin/browser profile, and needs no redeployment. It is not part of workspace backups and does not configure other users' browsers. Clearing site storage removes the override. Invalid input and failed storage writes retain the previous configuration. Changes during an active authorization attempt are rejected in that tab. Changing the ID affects future authorizations; existing sessions and their expiry timers remain intact. Browser sign-in accepts no client secret and never persists access or refresh tokens. A deployment default is still useful when every visitor should use the same client; changing that build-time variable requires redeployment.

Until a client is configured and Google consent succeeds, new workspaces cannot finish setup. Previously linked accounts retain offline access when their session expires. Disconnecting the last account requires reconnection; local data is preserved. Browser authorization uses Google Identity Services token consent; there is no server callback or `/api` endpoint to deploy. Google's consent-screen publication and scope verification requirements must be completed in the operator's project for its intended users.

The repository's Vercel integration deploys pushes to `main` at `https://hot-cross-buns.vercel.app`. Check the Vercel commit status alongside GitHub Actions after pushing. A configured local Vercel CLI can also deploy with `vercel --prod` after linking the intended project and verifying its production domain. No additional backend configuration is needed.

Configuration references: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [build settings](https://vercel.com/docs/builds/configure-a-build), and [rewrites](https://vercel.com/docs/routing/rewrites).

## Offline startup and updates

Only production builds register the service worker. The first successful online visit downloads the HTML, renderer chunks, lazy screens, dedicated database worker, and SQLite WASM into a versioned app-shell cache. Workspace content remains in IndexedDB. The service worker never caches Google requests, OAuth traffic, or application database snapshots.

A new build installs into a separate cache and waits until all existing planner tabs close before activation. It then deletes only obsolete Hot Cross Buns app-shell caches. Failed downloads discard only the incomplete new cache, preserving the existing usable app and IndexedDB workspace. A failed first installation leaves the online app usable and exposes an actionable offline status; reopen online to retry. The registration script exposes `window.hcbOffline` and the `hcb:offline-status` event with `preparing`, `ready`, `update-ready`, or `unavailable` state. Offline readiness requires the initial complete download; opening a never-visited origin while offline cannot work.

Service workers require HTTPS (localhost is allowed for development). Browser storage eviction or explicitly clearing site data can remove offline assets and the workspace. Export a workspace backup from Settings before changing origin or clearing browser data. The app requests persistent storage through its browser storage controls when supported; the browser decides whether to grant it.

Lifecycle references: [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [using service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), and [Chrome's lifecycle guidance](https://developer.chrome.com/docs/workbox/service-worker-lifecycle).

## Verification

`corepack pnpm test:release-gate` builds the production application, runs production and offline checks, native SQL regressions, unit tests, and browser interaction/persistence tests. `corepack pnpm test:offline` requires an existing production `dist/`; it serves that build on an isolated local port and uses real Chromium, Cache Storage, IndexedDB, and network-offline mode. It checks cold-tab startup, lazy screens, durable offline edits and FTS, failed updates, delayed successful activation, and failed first-install recovery. Its machine-readable results are written to `output/offline-validation.json`.

`corepack pnpm measure:storage` builds an isolated test-mode application and measures fresh contexts containing 1,000 and 5,000 records **per domain** (tasks, notes, events: 3,000 and 15,000 total). Results include reopen latency, search/calendar queries, durable edits, SQLite export and IndexedDB commit costs, renderer heap and worker WASM allocation, main-thread long tasks, and frame gaps. Raw observations and machine/browser metadata are stored in `docs/performance/browser-mixed.json`; measurements are not device-independent guarantees. The benchmark uses the [Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) and [Chromium heap diagnostics](https://chromedevtools.github.io/devtools-protocol/v8/Runtime/).

CI runs the production/offline, unit, native-domain, and browser suites on Linux and macOS. Linux additionally records the mixed-workspace benchmark; reports are uploaded as CI artifacts. Production deployments should use these checks as their release gate.
