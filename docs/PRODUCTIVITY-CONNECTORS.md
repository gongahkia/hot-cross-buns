# Productivity connections

Open **Settings → Connections** to add Microsoft 365, Linear, Todoist, Dropbox,
or a custom MCP server. HCB can also guide setup in chat: ask “Help me connect
Todoist” or “Connect this remote MCP server”. It inspects supported choices,
collects public configuration, and prepares an exact review. The saved connection
opens in Connections after the reply for private authentication. Never paste
credentials in chat. Select the saved connection for subsequent messages; adding
an account does not add tools to a running request or grant permission.

| Connection | Reads | Reviewed changes |
| --- | --- | --- |
| Microsoft 365 | Outlook mail/folders, bounded calendar views/events, OneDrive folders/search/metadata, SharePoint sites/libraries, Teams channels/chats/messages | Plain-text mail and Teams messages/replies; calendar create/edit/delete; file rename/move/delete, folders, organization view links |
| Linear | Viewer/organization, teams/users, workflow states/labels, issues/projects, issue comments | Issues/projects create/edit/archive/restore/delete; comments create/edit/delete |
| Todoist | Account, tasks/filter search, projects/sections/labels, task/project comments | Create/edit/delete resources, complete/reopen/move tasks, archive/restore projects, comments |
| Dropbox | Account, folder listing/search, metadata/revisions/shared links, files up to 128 KiB | Folders, move/copy/delete/restore, shared-link create/revoke |

All responses are bounded to 256 KiB. Continue lists with the service cursor; no
connector silently downloads an entire account. Read descriptions identify
`resource_id` formats and cursor semantics. Writes use HCB's existing exact-action
review and evidence journal. Unknown outcomes require inspection before retrying.
No automatic write retry is added. These connectors do not implement arbitrary
provider APIs, large file transfer, file synchronization or background webhooks.

## Microsoft 365

Register a public application in Microsoft Entra with the account audience you
need and enable public client/device-code flows. Supply its public application
client ID. Default delegated scopes are `offline_access User.Read Mail.Read
Calendars.Read Files.Read`. Sign-in displays a short-lived device code in the
private Connections page. Open the linked Microsoft page in your own browser,
verify the account and approve the requested scopes. Access and refresh tokens
stay in the local private store; expired access tokens use the refresh grant.

Add only the additional delegated scopes needed by the requested workflow:
`Sites.Read.All` for SharePoint; `Team.ReadBasic.All`, `Channel.ReadBasic.All`,
`ChannelMessage.Read.All`, `Chat.Read` for Teams reads; `Mail.Send`,
`Calendars.ReadWrite`, `Files.ReadWrite`, `ChannelMessage.Send`, `ChatMessage.Send`
for corresponding changes. Tenant policy may require administrator consent, and
Teams APIs need a supported work/school account. Exposed operations reflect the
configured scopes; service authorization remains authoritative. To change scopes,
create a separately named connection with the desired scope set and sign in.

Event edits/deletes and drive item edits/moves/deletes require the current
`expected_etag` from a fresh read. A stale resource fails its `If-Match` check.
Email HTTP 202 means Microsoft accepted submission; it does not establish delivery.
Calendar messages to attendees and file sharing can have external effects, so
review recipients and targets. Downloads from OneDrive URLs are not implemented;
metadata URLs never receive the account token automatically.

[Microsoft device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code),
[Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

## Linear, Todoist and Dropbox

Linear uses a personal API key (raw Authorization header) or a separately
configured OAuth app (Bearer). GraphQL documents are host-owned; model values are
variables. GraphQL errors and missing/false mutation success are failures even
with HTTP 200. Queries filter issue titles or project names and use cursor
pagination. This is not Linear's cross-resource full-text search.
[Linear API guide](https://linear.app/developers/graphql).

Todoist uses the personal API token from Settings → Integrations → Developer.
The connector uses API v1 opaque IDs, filter queries and cursor pagination.
Temporary IDs are rejected. Task moves have one explicit destination; comments
have one task or project parent. [Todoist API](https://developer.todoist.com/api/v1/).

Dropbox uses your scoped app token. Prefer App folder access; existing files
outside it require Full Dropbox. Reads need `account_info.read`,
`files.metadata.read`, and `files.content.read`; add matching write/sharing scopes
only for wanted operations. Generated tokens may expire. For renewable access,
chat can prepare public OAuth app endpoints/client ID/scopes; sign in privately
using your registered loopback callback. No Dropbox OAuth app is bundled.
Downloads are limited to 128 KiB and return text or base64 plus metadata/hash.
Larger imports/uploads are not implemented. Moves/copies disable autorename and
ownership transfer. Shared links use Dropbox's default policy and may be public.
[Dropbox OAuth guide](https://developers.dropbox.com/oauth-guide).

## Verification limits

Automated tests use local HTTP fixtures, including reviewed changes, private
credentials, device sign-in, GraphQL failures and mapping discovery. Real service
accounts, tenant consent, delivery and provider-specific account policies require
live checks after sign-in. No live account credentials are part of repository tests.
