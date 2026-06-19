# HCB2 Local Hoster Protocol

Local hosters are opt-in loopback integrations for terminal tools and local
automation. They reuse the local MCP bearer token and planner services; they do
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

`/hcb/v1/info` returns hoster profiles visible to the caller. A profile must
have `host.info` to be returned for a profile-specific info request.

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
  "kind": "hot-cross-buns-2-local-hoster",
  "createdAt": "2026-06-19T00:00:00.000Z",
  "appVersion": "5.0.0",
  "hosterId": "hoster:...",
  "name": "Terminal",
  "capabilities": ["host.info", "signal.send", "planner.read"],
  "permissionMode": "confirm-writes",
  "endpoint": "http://127.0.0.1:4778/hcb/v1/signal",
  "keyFingerprint": "<sha256 hex>",
  "payloadFile": "payload.hcbenc",
  "payloadSha256": "<sha256 hex>"
}
```

When exported with `--passphrase-env`, the manifest also includes `keyWrap`.
`keyWrap` uses `scrypt` plus AES-256-GCM to wrap only the 32-byte package key.
The passphrase is never stored in the package, command preview, confirmation
record, or logs.

`payload.hcbenc` is AES-256-GCM JSON containing encrypted profile and key
material. The payload is authenticated with the hoster id as AAD. Tampering with
the payload, checksum, key wrap, or profile fingerprint rejects import.

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
