# Google setup for the browser application

A Google account is required to use the planner, including previously completed or skipped local-only workspaces. Once setup is complete, cached tasks, notes, calendars, search, settings, and undo remain available offline; reconnect Google when you want to sync. A real Google Web application OAuth client is required to test live consent and synchronization; automated tests use a mocked Google Identity Services popup and mocked API responses.

## Configure Google Cloud

1. Create/select a Google Cloud project and enable **Google Tasks API** and **Google Calendar API**. Enable **Google Drive API** and **Gmail API** only if those optional features will be used.
2. Configure the OAuth consent screen/Google Auth Platform branding, audience, and requested data access. For an external application in Testing, add the people who will test as test users. Public distribution may require Google verification for the selected scopes, particularly sensitive or restricted optional scopes; follow the console's current requirements.
3. Create an OAuth client with application type **Web application**. This is different from the old Desktop client.
4. Register each exact origin under **Authorized JavaScript origins**, including scheme and port. Examples: `http://localhost:5173`, `http://127.0.0.1:5173`, or `https://planner.example.com`. For localhost testing, Google also instructs adding `http://localhost` alongside the origin with its port. Origins have no URL path. A different host, scheme, or port needs its own entry. Production should use HTTPS.
5. Set `VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com` in the build environment (or an uncommitted `.env.local` for development), then restart Vite or rebuild/redeploy. Vite embeds this public client ID into the browser bundle. **Never put a client secret, service-account key, access token, or refresh token in a `VITE_` variable.** This token-model popup flow does not use a redirect callback endpoint or client secret.
6. Choose **Connect Google** during initial setup, or open Settings → Accounts and choose **Add Google Account** for an existing workspace. Allow the popup, select the intended account, and review the consent screen. Cached Google data and unsent changes remain local when disconnected. Reconnect buttons verify that the chosen Google `sub` matches the existing account; changing identity requires adding a separate account.

## Requested access

The repository includes `.env.example`. Vite explicitly loads environment files from the repository root, alongside `package.json`, using its documented [envDir option](https://vite.dev/config/shared-options#envdir). `.env.local` and mode-specific local files are ignored by Git.

| Purpose | Scope |
| --- | --- |
| Stable account identity and profile | `openid`, `email`, `profile` |
| Read/write Google Tasks and task lists | `https://www.googleapis.com/auth/tasks` |
| Read/write calendars, events and availability | `https://www.googleapis.com/auth/calendar` |
| Optional Drive search/link metadata | `https://www.googleapis.com/auth/drive.metadata.readonly` |
| Optional explicitly selected Drive uploads | `https://www.googleapis.com/auth/drive.file` |
| Optional Gmail read-only search and capture | `https://www.googleapis.com/auth/gmail.readonly` |

Drive/Gmail scopes are requested through **Reconfigure Google access** after connecting an account. Consent can be partial: the application displays the actual granted scopes and only uses granted services. Reconfiguration requests a replacement token limited to the selected scopes (`include_granted_scopes: false`). Removing a scope from this browser session does not revoke previously granted permissions on Google's account page. Disconnecting HCB removes this browser's session; manage application-wide grants through [Google Account connections](https://myaccount.google.com/connections).

## Session and failure behavior

GIS loads from `https://accounts.google.com/gsi/client`. Its token popup is invoked directly from the user's click. The access token verifies the profile at `https://openidconnect.googleapis.com/v1/userinfo`; the stable `sub`, not the email address, identifies the account. API access tokens are held only in tab/worker memory, never in IndexedDB, localStorage, workspace exports, or application diagnostics. The browser does not hold a client secret or refresh token.

Reloading, closing the tab, token expiry, or rejected credentials requires user-driven reconnection. There is no unattended background Google sync after all application tabs close. Popup blocking/closure, denial, unavailable scripts/network, expired sessions, and identity mismatch return actionable errors while keeping local data and queued changes. Different browser tabs have separate in-memory Google sessions and share the local IndexedDB workspace through the writer lock.

Automatic synchronization catches up on foreground/resume and network reconnection. Tabs share per-account attempt/cooldown metadata, so multiple authorized tabs do not multiply polling. An authorized tab can deliver changes saved in another tab without a token. Hidden tabs skip idle downloads; manual mode disables automatic work. See [implementation progress](sync-implementation.md) for timings, retry behavior and validation.

Deployments must retain the included GIS CSP allowances for its client script, frames, network requests, and `https://accounts.google.com/gsi/style` stylesheet. See Google’s [CSP and popup configuration](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). If adding a Cross-Origin-Opener-Policy header, use `same-origin-allow-popups` so consent popups can communicate with the app.

Google credentials and API responses are never stored by the offline application-shell cache. An online first load is needed to download the app; offline local planning remains available once Settings → Data reports offline readiness. OAuth and remote sync require network access.

## Sources and validation

Implementation follows Google's current [token-model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [GIS JavaScript reference](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Web application setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), and [OpenID Connect userinfo documentation](https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo).

Focused validation:

```sh
corepack pnpm exec vitest run src/browser/googleAuth.test.ts src/browser/googleSync.test.ts src/renderer/src/googleCapabilities.test.ts
corepack pnpm exec playwright test tests/browser/browser-controls.spec.ts tests/browser/account-required.spec.ts
```

The browser test configures a test-only client ID through the test build facade, checks user activation, mocks the official userinfo/API endpoints, verifies real worker synchronization, confirms token exclusion from exported SQL, and reloads to demonstrate that authorization is not persisted. Production builds omit this configuration hook. A deployment's real OAuth origin/consent configuration still needs a live browser pass with that deployment's client and authorized test account; no real account connection has been fabricated by the tests.
