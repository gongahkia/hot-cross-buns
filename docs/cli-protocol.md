# CLI machine protocol

Protocol version 1 is opt-in with `--json` and is designed for editor and automation clients.

Output is UTF-8 JSON Lines. Every stdout line is one JSON object with `protocol: 1`, `type`, and a deterministic payload. The protocol-enabled commands (`lock`, `sync`, `update`, `status`, `outdated`, `audit`, `tree`, `why`, `source add`, `source list`, `source remove`, `source validate`, and `godot`) emit `started`, zero or more `progress`, then exactly one `result` event on success. Human output is suppressed in this mode.

`sync` package progress additionally includes `package`, `completed`, and
`total`. Its `phase` is `validating-source`, `preparing-package`, or
`package-ready`; the existing coarse phases remain available. These additive
fields preserve protocol version 1 compatibility.

`lock` results include the lockfile schema, whether publication changed it,
package count, and Godot compatibility. `update` results include the lockfile
schema, dry-run state, changed package names, optional sync summary, and Godot
compatibility. `source add` and `source remove` results include the catalog
schema, candidate name, and completed operation. These fields are additive in
protocol version 1.

Managed Godot download progress includes `artifact`, `completed`, and `total`
byte counts with phase `downloading`. Release resolution, checksum retrieval,
extraction, and template installation use additive `phase` values. A transient
unpinned release-metadata outage can emit a protocol-v1 `warning` event with
phase `godot-toolchain-unavailable`; automation must not treat an unknown event
type as an error.

Failures emit JSON diagnostics to stderr and retain the stable process exit codes: `0` success, `2` user input, `3` source access, `4` integrity, and `70` internal failure. Commands normally emit one diagnostic; `source validate` emits one deterministic protocol-v1 diagnostic per declaration failure. The diagnostic object contains `code`, `message`, `package`, `source`, `modified`, `rollback`, and `recovery`; absent optional values are JSON null. Sources and causes remain credential-redacted.

Clients must ignore unknown object fields and unknown event types. A changed `protocol` value is a breaking protocol change. JSON Lines permits one independently parseable JSON value per line, which keeps progress streaming without buffering a command result. See [JSON Lines](https://jsonlines.org/) and [RFC 8259](https://www.rfc-editor.org/info/rfc8259).

Cancellation uses the operating-system interrupt signal. The CLI bridges it to core cancellation tokens for `add`, `remove`, `update`, `lock`, and `sync`; the signal is observed before mutation or between transaction stages. If it arrives during a commit, the commit finishes as one valid transaction and the command returns a cancellation diagnostic with exit status `3`, never success.
