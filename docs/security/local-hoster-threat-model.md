# Local Hoster Threat Model

Status: internal review only. No external security review has been completed.

## Boundary

- Signal listener binds only to `127.0.0.1`.
- Signal auth uses the local MCP bearer token.
- Signal dispatch reuses MCP tool handlers and permission modes.
- `.hcbhost` packages contain non-secret manifest metadata plus encrypted payload.
- Private signal bodies use X25519 + HKDF-SHA256 + AES-256-GCM envelopes.
- Vault host listeners are standalone CLI processes that may bind LAN addresses
  when explicitly requested. They store encrypted `.hcbvault` packages and do
  not receive vault passphrases.

## Protected Assets

- Google task/calendar data mirrored in local SQLite.
- Pending local mutations and confirmation ids.
- MCP bearer token.
- Local hoster package keys and X25519 private keys in `SecretStore`.
- Optional passphrase-derived package key wraps.
- Vault host bearer tokens supplied through `--token-env`.
- Optional saved vault host bearer tokens and vault passphrases in OS credential storage.
- Encrypted `.hcbvault` payloads and manifests stored on user-owned hosts.

## Main Threats And Controls

| Threat | Control |
| --- | --- |
| Remote network access | Hoster server binds `127.0.0.1`; non-loopback remote addresses are rejected. |
| Vault host token exposure | Remote clients require HTTPS outside loopback unless `--allow-insecure-http` is explicit. |
| Browser-origin abuse | Non-empty `Origin` headers are rejected. |
| Token theft/replay | Bearer token is never written to runtime files; signal request ids are recorded in SQLite and stale/future timestamps are rejected. |
| Capability escalation | Hoster profiles require `host.info`, `signal.send`, `planner.read`, and `planner.write`; admin/security tools are denied regardless of profile. |
| Package tampering | Payload checksum, AES-GCM auth tags, profile fingerprint checks, and signed v1 manifests reject modified signed packages. |
| Vault package tampering | Vault upload/download validates manifest schema and payload SHA-256 before package replacement or import. |
| Portable package key exposure | Passphrase wraps only the package key with `scrypt` + AES-256-GCM; raw package keys are not written to the manifest. |
| Secret store outage | Create/export/import/saved vault-host sync fail closed when `SecretStore` read/write fails. |

## Residual Risks

- Any local process that obtains the MCP bearer token can call allowed loopback APIs.
- Unsigned legacy v1 manifests remain importable when the package key is already present; new exports are signed.
- This is not the full Signal Protocol and does not provide multi-device identity, deniability, or asynchronous ratcheting.
- Passphrase strength is user-controlled; weak passphrases reduce portable package protection.
- Saved vault passphrases are exposed to any local process that can read the user's OS credential store under this app identity.
- Vault host sync is snapshot push/pull. Pull replaces local HCB state and does
  not merge concurrent writers.
- Explicit LAN HTTP override protects vault contents through payload encryption
  but still exposes bearer credentials to anyone able to observe the transport.

## Required Review Before Third-Party Use

- External security review of loopback auth/origin/rate-limit posture and vault host transport/auth.
- Fuzzing against HTTP parsing, manifest parsing, key wrap parsing, and envelope parsing.
- OS-specific SecretStore failure testing on macOS Keychain, Windows safeStorage, and Linux Secret Service.
- UX review for token reset, port conflicts, hoster profile revocation, and destructive vault pull recovery.
