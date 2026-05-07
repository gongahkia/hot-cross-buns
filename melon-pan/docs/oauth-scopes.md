# OAuth scope choices

Melon Pan asks for one of two scope sets at sign-in. The default trades
breadth for the ability to open any Doc the signed-in user already has.
The narrow set trades that for a strict per-file access boundary.

## Default (broad)

Granted by the default macOS sign-in flow:

- `https://www.googleapis.com/auth/drive.file` — read/write Drive files
  the app creates or the user explicitly opens.
- `https://www.googleapis.com/auth/documents` — full read/write of every
  Google Doc owned by the user. **Required** to open Docs the user
  authored elsewhere (e.g. in the Docs web UI) without re-importing.
- `https://www.googleapis.com/auth/userinfo.email` — for the account
  chip / email-keyed token storage.
- `openid` — pairs with userinfo so Google returns the email claim.

The `documents` scope sounds broad in the consent screen because it is.
Most users see "see, edit, create and delete all your Google Docs
documents" and feel uneasy. That copy is accurate.

## Narrow (`--narrow-scope`)

Granted by the narrow macOS sign-in flow:

- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/userinfo.email`
- `openid`

The `documents` scope is dropped. Effects:

- **You can still:** create new Docs from Melon Pan and edit them;
  cache them locally; push back. Files stay accessible because
  `drive.file` covers anything the app creates or the user explicitly
  opens via Drive Picker.
- **You lose:** opening pre-existing Docs by ID unless the doc was
  created by Melon Pan or access is granted through Drive Picker.
- **You lose:** browsing Docs you did not create, since Drive only
  returns app-scoped files.

## When to pick which

- **Default**: you have an existing library of Docs and want them all
  available locally as Markdown. This is the typical user.
- **Narrow**: you only use Melon Pan to author *new* Markdown that
  syncs to Drive, and you want Google's consent screen and revocation
  page to reflect that. Privacy-respecting and reversible — running
  signing in again with the default scope set re-grants the broader
  access.

Switching scopes is a re-authorization: revoke the existing token
sign out to clear the stored copy; revoking on the Google side at
<https://myaccount.google.com/permissions> drops it server-side too)
and sign in again with the desired scope choice.
