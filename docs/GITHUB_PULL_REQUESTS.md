# GitHub pull requests

Add GitHub in Connections with an exact repository API URL, for example
`https://api.github.com/repos/owner/repo`, then enter a fine-grained token privately.
Choose only that repository. PR reads need Pull requests read; PR changes need
write. Check runs need Checks read; commit/status reads need Contents and Commit
statuses read as required by GitHub. HCB does not reuse Codex or Copilot credentials.

Select the connection in chat. HCB can list PRs, read a PR, changed files, reviews,
conversation comments, commit check runs and combined statuses. Reads are bounded
and paginated; absent patches and unread pages are not complete review evidence.

It can create a draft PR from an existing same-repository branch, update title,
body or state, post a comment, submit a review, or merge. Each write enters the
existing exact foreground approval and durable action journal. Draft and scheduled
runs can prepare proposals but cannot execute these actions. The review contains
the repository, operation, content and expected head commit. A changed head stops
execution and requires a new read and review. Merge also sends GitHub's atomic
`sha` guard; reviews bind `commit_id`. GitHub branch protection remains authoritative.
A preflight head check for comments/metadata is not a server-side atomic lock.

The agent must read relevant checks, statuses and reviews before proposing a merge;
it must report pending, failed or incomplete checks. HCB does not bypass branch
rules. Unknown network outcomes or missing confirmation stay uncertain rather than
being reported as success or retried automatically. Consult GitHub before repeating.

Code generation, local commits and authorized pushes use the existing local CLI
worker and filesystem workflow. This connector does not execute arbitrary shell
commands, push code, manage credentials or create repositories. Fork PR creation
and GitHub Enterprise require additional adapters.

Protocol reference: https://docs.github.com/en/rest/pulls/pulls
