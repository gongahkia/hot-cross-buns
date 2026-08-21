# Security Policy

Only the latest release is supported for security fixes.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/gongahkia/hot-cross-buns/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected version, operating system, installation method,
reproduction steps, and impact. Security-sensitive areas include Desktop OAuth,
OS keyring storage, Google API transport, SQLite local data, import/export,
notifications, and diagnostics.

Never include real OAuth client credentials, access or refresh tokens, keyring
contents, local databases, exports containing personal data, raw Google
payloads, or unredacted diagnostics. HCB has no hosted backend: synchronized
data flows directly between the local Python process and Google APIs.
