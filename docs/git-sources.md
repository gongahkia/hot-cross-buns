# Git source canonicalisation

Wukong canonicalises Git declarations and the core fetcher resolves immutable
commits for locking. Supported declaration forms are HTTPS,
`ssh://[user@]host/path`, and Git's `user@host:path` SSH form.

HTTPS identities canonicalise scheme and host casing and omit port 443. SSH
host aliases and paths remain unchanged so they retain the user's Git and SSH
configuration meaning. Passwords, HTTPS user info, query parameters, and
fragments are rejected. Diagnostics redact source user information.

`rev` requires a complete 40- or 64-character hexadecimal object ID. `tag` and
`branch` are accepted as manifest inputs but are not immutable identities. Git
fetching must resolve them to commits before a Git source can be locked. Git
version-tag discovery is separate from direct selectors; see
[ADR 0020](adr/0020-git-source-canonicalisation.md) and
[ADR 0026](adr/0026-git-version-discovery.md).
