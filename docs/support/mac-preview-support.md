# macOS Preview Support

The app is macOS-first. Package signing and notarization are release-specific facts, not assumed preview properties; check the release artifact and [distribution guide](../release/distribution.md).

## Support evidence

- exact app version and macOS version
- redacted CMake/test output or diagnostics summary
- whether the failure reproduces with a fresh local cache
- redacted screenshot of the native permission or error prompt

Do not share OAuth client details, access/refresh tokens, SQLite databases, unredacted calendar/task text, or private event screenshots. Live account work follows [live Google smoke](../testing/live-google-smoke.md).

Current scope excludes a global quick capture shortcut, local MCP server, automatic updater, and Linux/Windows support.
