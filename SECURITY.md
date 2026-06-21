# Security Policy

## Supported Versions

Only the latest public release is supported for security fixes. The current supported release line is `v5.0.0`.

## Reporting A Vulnerability

Report vulnerabilities privately through GitHub Security Advisories:

https://github.com/gongahkia/hot-cross-buns/security/advisories/new

Do not open a public issue for suspected vulnerabilities.

Include:

- affected version or commit
- operating system and install source
- reproduction steps or proof of concept
- security impact
- whether credentials, tokens, local data, or MCP access are involved

Do not include real Google OAuth tokens, OAuth client secrets, MCP bearer tokens, signing material, local databases, raw Google payloads, or unredacted diagnostics.

## Scope

Security-sensitive areas include:

- Google OAuth and token storage
- OS credential storage
- SQLite cache handling
- Electron preload and IPC boundaries
- local MCP server access
- diagnostics and log redaction
- release artifacts, checksums, signing, and notarization

## Response

Reports are reviewed privately first. If accepted, fixes are prepared on a private branch or advisory workflow when needed, then released with appropriate credit unless the reporter asks otherwise.
