# macOS installation

From a source checkout, run the same animated and safety-conscious installer
used on other platforms:

```sh
./packaging/macos/install-hcb.sh
```

It prefers `uv` and falls back to `pipx`; install one with Homebrew first if
neither is present. The script installs only the local checkout, does not
launch HCB, and does not connect a Google account. See the root
[installation guide](../../README.md#install) for the canonical Git-source
installer, pinned-ref, accessibility, and troubleshooting options.

Reminders are not installed automatically. After connecting and syncing an
account, explicitly enable the per-user LaunchAgent:

```sh
hcb daemon install
hcb daemon status
```

Remove it with `hcb daemon uninstall`. The agent runs `hcb daemon run`; use
`hcb daemon run --once` to test delivery without installing anything.
