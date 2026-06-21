# HCB Local Hoster Protocol

Local hosters have two separate surfaces:

- signal hosters: loopback integrations for terminal tools and local automation
- vault hosts: encrypted `.hcbvault` package storage for trusted local machines

Signal hosters reuse the local MCP bearer token and planner services; they do
not open LAN listeners or introduce a separate mutation path.

## Server

- Bind address: `127.0.0.1` only.
- Routes: `POST /hcb/v1/info` and `POST /hcb/v1/signal`.
- Auth: `Authorization: Bearer <local MCP token>`.
- Origin: browser origins are rejected; CLI/no-origin requests are accepted.
- Body: JSON only, bounded by the same local HTTP request size posture as MCP.
- Rate limit: loopback requests are rate-limited per remote address.
- Lifecycle: persisted `localHostersEnabled`/`localHosterPort` settings are
  applied during main-process startup. Status reports `health`,
  `configuredPort`, effective `port`, live `endpoint`, start/stop timestamps,
  and sanitized bind errors such as `EADDRINUSE`.

## Vault Host Server

Vault hosts are standalone CLI servers for a Raspberry Pi, another laptop, NAS,
or loopback process. They store only `.hcbvault` packages:

```text
current.hcbvault/
  manifest.json
  payload.hcbenc
```

Routes:

- `GET /hcb/v1/vault/info`: returns protocol version, supported vault format
  versions, max package bytes, package SHA-256, and current manifest metadata
  when a vault exists.
- `GET /hcb/v1/vault`: downloads the manifest plus encrypted payload.
- `PUT /hcb/v1/vault`: uploads/replaces the manifest plus encrypted payload.

Auth is `Authorization: Bearer <host-token>`. The host token is supplied by
`--token-env`; it is not embedded in the vault package. Clients refuse
non-loopback HTTP by default. Use HTTPS, a VPN/tunnel, or an explicit
`--allow-insecure-http` override for trusted LAN tests.

Vault hosts do not receive the passphrase. Clients export/import locally with
the passphrase, then push/pull the already-encrypted package. Upload validates
the manifest schema and payload SHA-256 before replacing the hosted package.
Replacement is atomic at the package-directory level.
Clients that have a last-seen package SHA-256 send it as `If-Match` on upload;
the host rejects stale uploads with HTTP 412 instead of overwriting a newer
hosted vault.

CLI:

```sh
hcb vault serve --path /srv/hcb/current.hcbvault --host 0.0.0.0 --token-env HCB_VAULT_HOST_TOKEN
hcb vault remote-status --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN
hcb vault push --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN --passphrase-env HCB_VAULT_PASSPHRASE --apply
hcb vault pull --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN --passphrase-env HCB_VAULT_PASSPHRASE --apply
```

The Settings storage panel exposes the same host check, push, and pull path for
configured HCB hoster mode. Tokens and passphrases may be entered per action or
saved in OS credential storage. They are not persisted in local settings. When
saved credentials exist, app Refresh, scheduled sync, and CLI/TUI sync push the
current encrypted `.hcbvault` package to the configured hoster endpoint.

Semantics are snapshot push/pull. Pull is destructive and routes through the
same `.hcbvault` import path as local import. v1 does not implement CRDT,
operation-log replication, or multi-writer conflict merging.

`/hcb/v1/info` returns hoster profiles visible to the caller. A profile must
have `host.info` to be returned for a profile-specific info request. The
response also includes `protocol` compatibility metadata: protocol version,
supported `.hcbhost` format versions, signal versions, algorithms, and route
names. v1 supports only `.hcbhost` format `1` and signal format `1`.

`/hcb/v1/signal` dispatches a strict signal payload through existing MCP tool
handlers. It accepts either raw `payload` or encrypted `envelope`; private
requests must use `envelope`.

```json
{
  "profileId": "hoster:...",
  "payload": {
    "formatVersion": 1,
    "requestId": "cli:request-1",
    "createdAt": "2026-06-19T00:00:00.000Z",
    "toolName": "hcb_status",
    "arguments": {}
  }
}
```

Replay protection stores `(profileId, requestId)` receipts in SQLite. Requests
older than 5 minutes, more than 60 seconds in the future, or already seen are
rejected.

## Capabilities

Profiles have explicit capabilities:

- `host.info`: may read profile/server info.
- `signal.send`: may send `/signal` requests.
- `planner.read`: may dispatch read-only planner tools.
- `planner.write`: may dispatch planner write tools, still subject to the
  existing MCP permission mode and confirmation flow.

Hoster dispatch denies admin/security tools regardless of profile capability:
settings writes, Google OAuth tools, MCP admin tools, hoster admin tools,
doctor/log/tail diagnostics.

## `.hcbhost`

A `.hcbhost` package is a directory:

```text
example.hcbhost/
  manifest.json
  payload.hcbenc
```

`manifest.json` is non-secret metadata:

```json
{
  "formatVersion": 1,
  "kind": "hot-cross-buns-local-hoster",
  "createdAt": "2026-06-19T00:00:00.000Z",
  "appVersion": "5.0.0",
  "hosterId": "hoster:...",
  "name": "Terminal",
  "capabilities": ["host.info", "signal.send", "planner.read"],
  "permissionMode": "confirm-writes",
  "endpoint": "http://127.0.0.1:4778/hcb/v1/signal",
  "keyFingerprint": "<sha256 hex>",
  "payloadFile": "payload.hcbenc",
  "payloadSha256": "<sha256 hex>",
  "manifestSignature": {
    "algorithm": "HMAC-SHA256",
    "signedFields": "manifest-without-manifestSignature",
    "valueBase64Url": "..."
  }
}
```

When exported with `--passphrase-env`, the manifest also includes `keyWrap`.
`keyWrap` uses `scrypt` plus AES-256-GCM to wrap only the 32-byte package key.
The passphrase is never stored in the package, command preview, confirmation
record, or logs.

`payload.hcbenc` is AES-256-GCM JSON containing encrypted profile and key
material. The payload is authenticated with the hoster id as AAD. Tampering with
the payload, checksum, key wrap, signed manifest, or profile fingerprint rejects
import. v1 import still accepts older unsigned v1 manifests when the package key
is already available, but new exports include `manifestSignature`.

## Compatibility Policy

- v1 clients should call `/hcb/v1/info` and compare `protocol` before assuming
  package or signal compatibility.
- Unsupported `.hcbhost` `formatVersion` and signal `formatVersion` values are
  rejected before import or dispatch.
- Additive manifest fields require a new compatible schema field and golden
  fixture update.
- Breaking payload, key-wrap, or signal changes require a new format or signal
  version and migration tests for old fixtures.
- Golden fixtures live under `tests/fixtures/local-hoster/` and are parsed by
  unit tests.

## Signal Encryption

Private signal envelopes use X25519 + HKDF-SHA256 + AES-256-GCM:

```json
{
  "version": 1,
  "algorithm": "X25519-HKDF-SHA256-AES-256-GCM",
  "ephemeralPublicKeyBase64": "...",
  "saltBase64": "...",
  "ivBase64": "...",
  "tagBase64": "...",
  "ciphertextBase64": "..."
}
```

This is not the full Signal Protocol. It is a local hoster envelope for
confidential payload transfer to a profile public key.

## CLI

```sh
hcb hoster status
hcb hoster create --name Terminal --permission-mode confirm-writes
hcb hoster export hoster-id --out /tmp/local.hcbhost --passphrase-env HCB_HOSTER_PASSPHRASE
hcb hoster import /tmp/local.hcbhost --passphrase-env HCB_HOSTER_PASSPHRASE
hcb hoster test hoster-id --private
hcb hoster signal hoster-id --tool hcb_status --arguments-json '{}'
hcb tui
hcb completion zsh
```

In `hcb tui`, `view vault`, `vault status`, `vault push`, and `vault pull`
operate on the configured vault host. Push and pull use the standard dry-run
then apply flow. When Settings saved vault-host credentials, TUI vault commands
use those credentials without echoing token or passphrase values in previews.

Writes use the standard dry-run/apply contract. `--passphrase-env` names an
environment variable; passphrases are not accepted as argv literals.

## Sample Local Client

```js
const token = process.env.HCB_MCP_BEARER_TOKEN;
const endpoint = "http://127.0.0.1:4778/hcb/v1/signal";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    profileId: "hoster:example",
    payload: {
      formatVersion: 1,
      requestId: `client:${Date.now()}`,
      createdAt: new Date().toISOString(),
      toolName: "hcb_status",
      arguments: {}
    }
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.json());
```

## Verification

Run:

```sh
pnpm typecheck
pnpm test:unit
pnpm hcb:smoke
```

Hoster-specific coverage includes schema validation, checksum mismatch,
encrypted payload tampering, passphrase import into a fresh SecretStore, bad
passphrase failure, capability denials, replay rejection, and CLI parse/format
coverage.
