# Browser deployment

Hot Cross Buns is a static Vite application. `corepack pnpm install --frozen-lockfile` followed by `corepack pnpm build` produces `dist/`. Serve the whole directory over HTTPS, including the hashed worker and SQLite WASM assets. No Node server, Electron runtime, API backend, or server database is required. Local development uses `corepack pnpm dev`; production preview uses `corepack pnpm preview`.

## Vercel

The repository's `vercel.json` specifies the install/build commands, `dist` output, SPA fallback, immutable hashed assets, and revalidation for the service worker, registration script, and HTML. Import this repository in Vercel, select its root directory, and deploy. The checked-in configuration supplies the build settings. Keep the same production hostname: browser workspaces are origin-specific and are not automatically transferred to a preview deployment or another hostname.

Initial onboarding requires a Google connection. Configure a Google Cloud **Web application** OAuth client and `VITE_GOOGLE_CLIENT_ID` in the Vercel build environment. Add the exact production origin to the client's authorized JavaScript origins. Add localhost separately for development. This is a public client ID; never put a Google client secret, refresh token, or access token in a Vite environment variable. Redeploy after changing build-time variables. Without this setting, new workspaces cannot finish setup. Previously completed workspaces retain local tasks, notes, calendar, search, and backups while disconnected. Browser authorization uses Google Identity Services token consent; there is no server callback or `/api` endpoint to deploy. Google's consent-screen publication and scope verification requirements must be completed in the operator's project for its intended users.

No authenticated Vercel session, linked project, or deployment token was available in the implementation environment. No live deployment was claimed. To deploy from a configured local Vercel CLI, link the intended project, verify its production domain and environment settings, then run `vercel --prod`. The equivalent Vercel repository import is sufficient; no additional backend configuration is needed.

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
