# Local Hoster Threat Model

Status: internal review only. No external security review has been completed.

## Boundary

- Listener binds only to `127.0.0.1`.
- Auth uses the local MCP bearer token.
- Hoster dispatch reuses MCP tool handlers and permission modes.
- `.hcbhost` packages contain non-secret manifest metadata plus encrypted payload.
- Private signal bodies use X25519 + HKDF-SHA256 + AES-256-GCM envelopes.

## Protected Assets

- Google task/calendar data mirrored in local SQLite.
- Pending local mutations and confirmation ids.
- MCP bearer token.
- Local hoster package keys and X25519 private keys in `SecretStore`.
- Optional passphrase-derived package key wraps.

## Main Threats And Controls

| Threat | Control |
| --- | --- |
| Remote network access | Hoster server binds `127.0.0.1`; non-loopback remote addresses are rejected. |
| Browser-origin abuse | Non-empty `Origin` headers are rejected. |
| Token theft/replay | Bearer token is never written to runtime files; signal request ids are recorded in SQLite and stale/future timestamps are rejected. |
| Capability escalation | Hoster profiles require `host.info`, `signal.send`, `planner.read`, and `planner.write`; admin/security tools are denied regardless of profile. |
| Package tampering | Payload checksum, AES-GCM auth tags, profile fingerprint checks, and signed v1 manifests reject modified signed packages. |
| Portable package key exposure | Passphrase wraps only the package key with `scrypt` + AES-256-GCM; raw package keys are not written to the manifest. |
| Secret store outage | Create/export/import fail closed when `SecretStore` read/write fails. |

## Residual Risks

- Any local process that obtains the MCP bearer token can call allowed loopback APIs.
- Unsigned legacy v1 manifests remain importable when the package key is already present; new exports are signed.
- This is not the full Signal Protocol and does not provide multi-device identity, deniability, or asynchronous ratcheting.
- Passphrase strength is user-controlled; weak passphrases reduce portable package protection.

## Required Review Before LAN Or Third-Party Use

- External security review of loopback auth/origin/rate-limit posture.
- Fuzzing against HTTP parsing, manifest parsing, key wrap parsing, and envelope parsing.
- OS-specific SecretStore failure testing on macOS Keychain, Windows safeStorage, and Linux Secret Service.
- UX review for token reset, port conflicts, and hoster profile revocation.
