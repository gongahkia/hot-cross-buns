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

Requested scopes:

- `https://www.googleapis.com/auth/tasks.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`
- `openid email profile`

The extension stores access tokens only in session extension storage with an in-memory fallback. It does not persist refresh tokens.
