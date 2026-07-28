# CLI machine protocol

Protocol version 1 is opt-in with `--json` and is designed for editor and automation clients.

Output is UTF-8 JSON Lines. Every stdout line is one JSON object with `protocol: 1`, `type`, and a deterministic payload. The protocol-enabled report commands (`outdated`, `audit`, `tree`, and `why`) emit `started`, zero or more `progress`, then exactly one `result` event. Human output is suppressed in this mode.

Failures emit exactly one JSON diagnostic to stderr and retain the stable process exit codes: `0` success, `2` user input, `3` source access, `4` integrity, and `70` internal failure. The diagnostic object contains `code`, `message`, `package`, `source`, `modified`, `rollback`, and `recovery`; absent optional values are JSON null. Sources and causes remain credential-redacted.

Clients must ignore unknown object fields and unknown event types. A changed `protocol` value is a breaking protocol change. JSON Lines permits one independently parseable JSON value per line, which keeps progress streaming without buffering a command result. See [JSON Lines](https://jsonlines.org/) and [RFC 8259](https://www.rfc-editor.org/info/rfc8259).

Cancellation uses the operating-system interrupt signal. The CLI bridges it to core cancellation tokens for `add`, `remove`, `update`, `lock`, and `sync`; the signal is observed before mutation or between transaction stages. If it arrives during a commit, the commit finishes as one valid transaction and the command returns a cancellation diagnostic with exit status `3`, never success.
