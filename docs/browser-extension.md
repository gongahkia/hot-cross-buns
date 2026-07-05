# Browser Extension

Hot Cross Buns includes a read-only browser extension for Google Tasks and Google Calendar.

## Build

```sh
pnpm typecheck:extension
pnpm build:extension
```

Outputs:

- `dist/browser-extension/chrome`
- `dist/browser-extension/firefox`

## OAuth Setup

The extension uses a bring-your-own Google OAuth client. Do not commit a real client ID.

1. Load the unpacked extension.
2. Open extension options.
3. Copy the displayed authorized redirect URI.
4. Add that redirect URI to a Google OAuth client.
5. Paste the OAuth client ID into extension options.
6. Connect Google from the sidebar.

If Google returns `redirect_uri_mismatch`, copy the redirect URI from the
extension options page again and add that exact value to the OAuth client. Chrome
and Firefox builds have different extension origins, so each installed build can
need its own authorized redirect URI.

Requested scopes:

- `https://www.googleapis.com/auth/tasks.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`
- `openid email profile`

The extension stores access tokens only in session extension storage with an in-memory fallback. It does not persist refresh tokens.

## Internal QA

Chrome is the only local browser present for this pass. Automated CLI loading is
not verified here because this local Google Chrome build logs
`--load-extension is not allowed in Google Chrome, ignoring.` Use the manual
unpacked flow below.

1. Run `pnpm build:extension`.
2. Open Chrome at `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked `dist/browser-extension/chrome`.
5. Open extension options and confirm the redirect URI is visible.
6. Open the side panel and confirm the unconfigured/configured states render.
7. Configure a valid OAuth client ID and run the Google connect flow.
8. Refresh the sidebar and verify grouped read-only results for tasks/events.

Firefox remains build/static validated until a local Firefox install or `web-ext`
runner is available. Use `dist/browser-extension/firefox` for manual load tests
on a Firefox machine.

## Keyboard

- `/`: focus search
- `r`: refresh while not typing
- `Escape`: clear search
- `ArrowDown` / `ArrowUp`: move the active result
- `Enter`: open the active result

## Scope

The extension is read-only. It does not create, update, complete, reopen, or
delete Google Tasks or Calendar events.
