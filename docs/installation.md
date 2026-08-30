# Install Hot Cross Buns

Hot Cross Buns is a Python 3.12+ terminal application. It is not currently
published to PyPI. Install the current Python client from the canonical Git
source with the dependency-free bootstrapper.

Do not use the old GitHub desktop-release assets for this client. They belong
to the retired pre-Python product and do not install the current HCB CLI/TUI.

## Recommended installation

The installer requires one isolated Python tool manager: [uv][uv] is preferred;
[pipx][pipx] is supported when uv is unavailable. It does not install either
prerequisite silently.

On macOS or Linux, download the script so that it can be inspected before it
runs:

```sh
curl --proto '=https' --tlsv1.2 -fL \
  https://raw.githubusercontent.com/gongahkia/hot-cross-buns/main/scripts/install-hcb.py \
  -o hcb-install.py
python3 hcb-install.py
```

On Windows, download the same script and run it with the Python launcher:

```powershell
Invoke-WebRequest `
  https://raw.githubusercontent.com/gongahkia/hot-cross-buns/main/scripts/install-hcb.py `
  -OutFile hcb-install.py
py hcb-install.py
```

The bootstrapper downloads the canonical Git source through uv or pipx, puts
the `hcb` command in that tool manager's normal executable directory, and
checks the installed command when it is already on `PATH`.

## The installation experience

In an interactive UTF-8 terminal, installation uses a compact, staged progress
card rather than a full-screen UI. It leaves scrollback intact, stores
package-manager output in a temporary log while it runs, and displays the log
path plus the final lines of output if an install step fails.

To see the complete animation without installing anything, run:

```sh
python3 hcb-install.py --demo
```

The preview does not invoke uv or pipx, access the network, or modify files.

For screen readers, CI, logs, and terminals without animation support:

```sh
python3 hcb-install.py --no-animate --no-color
# or
NO_COLOR=1 python3 hcb-install.py --no-animate
```

Use `--dry-run` to show the exact package-manager invocation without changing
your computer. Use `--verbose` to show it during a real installation.

The bootstrapper refuses to run as root on POSIX platforms. It never launches
HCB, creates a Google OAuth client, starts a daemon, connects an account, or
reads or writes existing HCB data. Google setup remains an explicit choice
inside HCB after installation.

## Install a specific revision or local checkout

By default, the installer follows the current `main` branch. This is convenient
for the current source-distribution phase. For a reproducible installation,
pass an immutable commit ID after reviewing that revision:

```sh
python3 hcb-install.py --ref COMMIT_ID
```

For a cloned checkout, install exactly the code on disk instead:

```sh
python3 scripts/install-hcb.py --source .
```

This mode is appropriate for contributors and makes no network request for the
HCB source itself. Use the normal development environment when editing HCB:

```sh
uv sync --extra dev
uv run hcb
```

## Update, PATH, and complete removal

Re-run the installer to refresh HCB from the selected ref. It uses `uv tool
install --reinstall` or `pipx install --force`, so the update replaces the
tool's isolated HCB environment without affecting other Python applications.

If installation succeeds but `hcb` is not found, add the tool manager's normal
binary location to a newly opened shell:

```sh
uv tool update-shell
# or
pipx ensurepath
```

Use HCB's own uninstall command to preview and then remove its complete local
footprint:

```sh
hcb uninstall --dry-run
hcb uninstall
```

The interactive command prints every target and requires typing `UNINSTALL`.
For an automated teardown, use `hcb uninstall --yes`. Its compact spinner
animates real cleanup work in an interactive terminal; use `--no-animate` for
logs and accessibility tools.

For an HCB installed by this bootstrapper, the command detects `uv` or `pipx`
and removes the executable only after all HCB state is cleanly removed. It
removes HCB's configuration, SQLite data, cache, credential `.env` files under
HCB's configuration directory, their known OS-keyring encryption keys, and the
macOS reminders LaunchAgent and log when present. Google Tasks, Calendar, and
Drive data are never changed. Shared `uv`/`pipx` caches are intentionally left
alone because they may belong to other applications.

An explicit `--env-file` or `HCB_ENV_FILE` outside HCB's configuration directory
is preserved by default. Delete it only when you explicitly include it in the
reviewed plan:

```sh
hcb --env-file /path/to/personal.env uninstall --include-env-file
```

If HCB was launched with `uv run` or another unrecognised installer, it cannot
safely infer how to remove its executable. Use `--keep-program` to remove only
HCB state, or name the package manager explicitly with `--package-manager uv`
or `--package-manager pipx`.

The direct package-manager commands remain a recovery option when `hcb` cannot
start:

```sh
uv tool uninstall hot-cross-buns
# or
pipx uninstall hot-cross-buns
```

## macOS checkout helper

The checkout includes a convenience wrapper for the same installer:

```sh
./packaging/macos/install-hcb.sh
```

After you have explicitly connected and synced an account, reminders can be
enabled separately with `hcb daemon install` on macOS.

## Verification status

The bootstrapper's source-checkout path and its animated and plain terminal
flows are exercised on Linux. The current CI workflow runs on Ubuntu only, so
the Windows command above has not been executed in this repository's CI.

[uv]: https://docs.astral.sh/uv/getting-started/installation/
[pipx]: https://pipx.pypa.io/stable/installation/
