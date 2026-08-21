# macOS installation

Install the Python CLI with an isolated environment:

```sh
brew install pipx
pipx install .
hcb --help
```

This layout is Homebrew-friendly: the `hcb` entry point is declared in
`pyproject.toml`, so a formula can use `virtualenv_install_with_resources`.
No generated executable or application bundle is checked in.

Reminders are not installed automatically. After connecting and syncing an
account, explicitly enable the per-user LaunchAgent:

```sh
hcb daemon install
hcb daemon status
```

Remove it with `hcb daemon uninstall`. The agent runs `hcb daemon run`; use
`hcb daemon run --once` to test delivery without installing anything.
