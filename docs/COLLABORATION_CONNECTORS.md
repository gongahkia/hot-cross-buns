# GitHub, GitLab, Slack and Notion

Configure these in **Hot Cross Buns → Connections**. Each connection has its own
identity, private token entry, access check and operation permissions. Multiple
repositories, projects or accounts use separate connections. Saving the connection
does not sign in; add its token and check access. Ask HCB to use the connection in
the main conversation. Task access and background access remain separately scoped.

## Supported workflows

| Service | Reads | Changes requiring review |
| --- | --- | --- |
| GitHub | Repository metadata, branches, files/directories at an exact commit, issues/comments, PR details/diffs/reviews/comments, commit checks/status, Actions runs/jobs/step conclusions | Create/edit/comment on issues; create draft PRs from existing same-repository branches; edit/comment/review/merge PRs |
| GitLab | Project metadata, branches, commits, files/tree at an exact commit, issues/notes, merge requests/diffs/notes/approvals/pipelines, project pipelines/jobs | Create/edit/comment on issues; create draft MRs from existing same-project branches; edit/comment/approve/merge MRs |
| Slack | Token identity, message search, channel/conversation discovery, channel history, thread replies | Post messages (including replies using `thread_ts`), update messages |
| Notion | Shared-page/data-source search, pages, blocks/children, database metadata, data-source schemas and filtered/sorted entries | Create pages/entries, update page properties, append blocks and edit/archive existing blocks |

These are bounded adapters, not complete coverage of each platform's API. File
content is returned as base64 JSON by code hosts. Large files and diffs can be
omitted or rejected by provider/response limits; the assistant must report those
gaps. GitHub directories are also subject to the provider's 1,000-entry limit.
Code writes, commits and pushes use separately authorized local CLI workflows.
Release management, CI triggering/cancellation, raw CI logs/artifact downloads,
Slack uploads/admin APIs and Notion uploads/comments are not implemented here.

## Setup

- **GitHub:** `https://api.github.com/repos/OWNER/REPO`. Use a fine-grained personal
  access token for that repository. Grant Contents, Checks, Actions, Pull requests
  and Issues read access as needed; add write access to Pull requests/Issues for
  reviewed changes. GitHub Enterprise hosts are not supported by this adapter.
- **GitLab:** `https://gitlab.com/api/v4/projects/123`, replacing `123` with the
  numeric project ID from project settings. Self-managed HTTPS hosts at the same
  API path are supported. Namespace-encoded project URLs and installation path
  prefixes are not supported. Use a personal/project access token with `read_api`
  for reads or `api` for reviewed changes, constrained to the needed account or
  project. GitLab approvals depend on edition, project rules and token identity.
- **Slack:** create/install a Slack app and supply its token privately. Search
  needs a user token with `search:read`. Discovery needs the appropriate channel
  read scopes; history/threads need the matching history scopes, membership and
  supported token type. Posting needs `chat:write`. Access to DMs/private channels
  is determined by the token and workspace policy. Slack's history/thread rate
  limits vary by app distribution; thread reads default to 15 results. No event
  subscription receiver is added by this change.
- **Notion:** use a connection token with Read content, and Insert/Update content
  when needed. Share the relevant pages with the integration. This adapter uses
  API version `2026-03-11`: database metadata identifies data sources, queries use
  `/data_sources/{id}/query`, and block insertion uses `position`. Read nested
  children separately; a page metadata read does not include its entire content.

## Execution boundaries

Reads retain source identity, endpoint, timestamp and content hash. Model tool
availability follows the existing selected-connection and permission rules.
Writes use the existing fresh-approval broker with an exact payload/target; a
read-only task cannot publish. An ambiguous outcome must be inspected before
retrying, particularly comments, appends, reviews and merges.

PR/MR actions check the reviewed head before dispatch. Merge operations also send
the SHA to the provider as an atomic head guard. GitHub reviews bind `commit_id`;
GitLab approvals send `sha`. Issue edits require `expected_updated_at` and re-read
the issue before sending. Timestamp/head preflights for ordinary edits/comments
are not transactions: a provider-side change can still race the final request.
Notion block updates do not provide an atomic edit precondition; inspect current
content first. GitLab quick actions beginning with `/` in descriptions or notes
are rejected so text cannot silently trigger a second, unreviewed action.

Pagination is explicit and bounded. Follow Slack/Notion response cursors. GitHub
and GitLab list calls accept page numbers 1–100 and up to 100 entries per page;
provider Link headers are not retained, so continue pages as needed and report
coverage bounds. No background automatic retries of external writes are added.

## API references and verification

- [GitHub issues](https://docs.github.com/en/rest/issues/issues),
  [PRs](https://docs.github.com/en/rest/pulls/pulls),
  [contents](https://docs.github.com/en/rest/repos/contents),
  [Actions runs](https://docs.github.com/en/rest/actions/workflow-runs).
- [GitLab authentication](https://docs.gitlab.com/api/rest/authentication/),
  [issues](https://docs.gitlab.com/api/issues/),
  [merge requests](https://docs.gitlab.com/api/merge_requests/),
  [approvals](https://docs.gitlab.com/api/merge_request_approvals/),
  [files](https://docs.gitlab.com/api/repository_files/).
- [Slack thread reads](https://docs.slack.dev/reference/methods/conversations.replies/)
  and [channel discovery](https://docs.slack.dev/reference/methods/conversations.list/).
- [Notion block insertion](https://developers.notion.com/reference/patch-block-children),
  [block updates](https://developers.notion.com/reference/update-a-block) and
  [data-source queries](https://developers.notion.com/reference/query-a-data-source).

Deterministic tests use local HTTP providers through the real connector runtime
and model-tool approval broker. They verify dispatch, pagination, attribution,
read-only ceilings, approval denial, stale heads/issue timestamps, route bounds,
quick-action rejection and missing confirmations. These do not establish that a
particular account's token/scopes or provider plan permits an operation. Account
access must be checked after connection setup; no real account writes are needed
for these tests.
