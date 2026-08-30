# Contributing

Hot Cross Buns is a Python 3.12 local-first TUI and CLI. Install the locked
development environment with:

```sh
uv sync --extra dev
```

Before submitting a change, run:

```sh
make format
make check
make build
```

Use `make benchmark` for changes that affect storage, search, rendering, or
sync throughput. Keep the CLI and TUI on the shared application layer, add
numbered and tested SQLite migrations, and preserve stable machine-readable
output and exit codes.

Google integration tests must use fakes unless a live test is explicitly
requested. Never commit OAuth client JSON, tokens, keyring data, local
databases, exports, raw Google payloads, or unredacted diagnostics. The ignored
`khal/` and `gcalcli/` directories are local references only and must not become
dependencies.
