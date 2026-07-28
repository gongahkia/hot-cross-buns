# Security guide

Wukong is designed to protect project files and reproducible source identity,
not to establish publisher trust or malware safety. Review the full
[threat model](threat-model.md), [credential policy](credentials.md), and
[security policy](../SECURITY.md).

- Lock Git dependencies to complete commits; tags and branches are manifest
  inputs, never final lock identities.
- Require and independently obtain HTTPS archive SHA-256 checksums.
- Verify release binaries against their published `SHA256SUMS`.
- Treat local paths and the shared cache as trusted-user inputs, not security
  boundaries against a malicious local account.
- Never put credentials, signed URLs, cookies, or headers in manifests,
  lockfiles, cache metadata, or bug reports.
- Wukong does not execute addon package scripts. Explicit `validate` execution
  runs only the Godot executable selected by the user.
- Do not bypass ownership conflicts or delete modified package-owned files;
  resolve the underlying project edit first.

Report vulnerabilities privately through [SECURITY.md](../SECURITY.md), with
secrets and private project details removed.
