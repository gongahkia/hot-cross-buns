# Issues

Use GitHub issues for reproducible bugs, platform install problems, feature requests, and documentation gaps.

Do not open public issues for security reports. Use [SECURITY.md](SECURITY.md) instead.

## Before Opening An Issue

- Search existing issues and the latest release notes.
- Use the matching issue form.
- Remove secrets and personal data from screenshots, logs, exports, diagnostics, and database paths.

## Useful Details

Include:

- app version
- Python version
- operating system and version
- install source: uv tool, pipx, or source checkout
- whether the failure is in the TUI, a CLI command, local storage, or Google sync
- steps to reproduce
- expected behavior
- actual behavior
- screenshots or logs, with secrets redacted

Never include Google OAuth tokens, OAuth client JSON, keyring contents, local
databases, personal exports, raw Google payloads, or unredacted diagnostics.
