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

In an interactive UTF-8 terminal, installation uses a small animated progress
indicator rather than a full-screen UI. It leaves scrollback intact, stores
package-manager output in a temporary log while it runs, and displays the log
path plus the final lines of output if an install step fails.

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

## Update, PATH, and removal

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

Remove HCB without deleting its local database or credentials:

```sh
uv tool uninstall hot-cross-buns
# or
pipx uninstall hot-cross-buns
```

Choose the matching command for the installer you used. Local HCB data remains
intact so that a later reinstall can use it; remove that data separately only
if you deliberately want to reset the application.

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
