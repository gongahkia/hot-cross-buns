"""Safe, complete local teardown for a Hot Cross Buns installation."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from .auth import TokenStore
from .credentials import credential_key_account
from .errors import ExitCode, HcbError
from .paths import AppPaths
from .scheduler import DaemonState

PACKAGE_NAME = "hot-cross-buns"
_T = TypeVar("_T")


class UninstallError(HcbError):
    """A local removal failure which leaves a clear recovery path."""

    exit_code = ExitCode.STORAGE_FAILURE


@dataclass(frozen=True, slots=True)
class RemovalTarget:
    """One exact HCB-owned file or directory eligible for deletion."""

    label: str
    path: Path


@dataclass(frozen=True, slots=True)
class PackageRemoval:
    """A verified package-manager command for the current HCB environment."""

    manager: str
    command: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class UninstallPlan:
    """All local effects shown before a destructive teardown begins."""

    targets: tuple[RemovalTarget, ...]
    credential_key_files: tuple[Path, ...]
    excluded_credential_file: Path | None
    package_removal: PackageRemoval | None
    running_daemon_pid: int | None
    daemon_cache_dir: Path
    launch_agent_path: Path | None


@dataclass(frozen=True, slots=True)
class UninstallResult:
    """A compact record of completed local cleanup work."""

    removed: tuple[str, ...]
    skipped: tuple[str, ...]
    package_removal: str
    deferred_log: Path | None = None


class RemovalProgress:
    """Render real removal work with a compact spinner on interactive terminals."""

    def __init__(self, *, enabled: bool, animate: bool = True) -> None:
        self.visible = enabled
        self.enabled = (
            enabled and animate and sys.stdout.isatty() and os.environ.get("TERM", "dumb") != "dumb"
        )
        self.unicode = "utf" in (sys.stdout.encoding or "").lower()
        self.frames: tuple[str, ...] = (
            "⠋",
            "⠙",
            "⠹",
            "⠸",
            "⠼",
            "⠴",
            "⠦",
            "⠧",
            "⠇",
            "⠏",
        )
        if not self.unicode:
            self.frames = ("|", "/", "-", "\\")

    def run(self, label: str, action: Callable[[], _T]) -> _T:
        if not self.visible:
            return action()
        if not self.enabled:
            print(f"  {'>' if not self.unicode else '›'} {label}")
            result = action()
            print(f"  {'OK' if not self.unicode else '✓'} {label}")
            return result

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="hcb-uninstall") as executor:
            future = executor.submit(action)
            frame = 0
            while not future.done():
                print(
                    f"\r\033[2K  {self.frames[frame % len(self.frames)]} {label}",
                    end="",
                    flush=True,
                )
                frame += 1
                time.sleep(0.08)
            print("\r\033[2K", end="", flush=True)
            result = future.result()
        print(f"  {'OK' if not self.unicode else '✓'} {label}")
        return result


def package_removal(
    preference: str,
    *,
    prefix: Path | None = None,
    find_executable: Callable[[str], str | None] = shutil.which,
) -> PackageRemoval | None:
    """Choose a package-manager removal command only when it is trustworthy."""

    selected = preference.casefold()
    if selected not in {"auto", "uv", "pipx"}:
        raise ValueError("--package-manager must be auto, uv, or pipx")
    manager = _manager_for_prefix(prefix or Path(sys.prefix)) if selected == "auto" else selected
    if manager is None:
        return None
    executable = find_executable(manager)
    if executable is None:
        raise ValueError(
            f"{manager} is required to remove this HCB installation but is not on PATH"
        )
    command: tuple[str, ...] = (executable, "tool", "uninstall", PACKAGE_NAME)
    if manager == "pipx":
        command = (executable, "uninstall", PACKAGE_NAME)
    return PackageRemoval(manager, command)


def _manager_for_prefix(prefix: Path) -> str | None:
    resolved = prefix.expanduser().resolve()
    if resolved.name != PACKAGE_NAME:
        return None
    if resolved.parent.name == "tools":
        return "uv"
    if resolved.parent.name == "venvs":
        return "pipx"
    return None


def build_plan(
    paths: AppPaths,
    *,
    active_credential_file: Path,
    credential_file_is_explicit: bool,
    include_explicit_credential_file: bool,
    package: PackageRemoval | None,
    platform_name: str | None = None,
    home: Path | None = None,
) -> UninstallPlan:
    """List exact HCB-owned state without reading credentials or changing disk."""

    platform_label = platform_name or sys.platform
    home_directory = (home or Path.home()).expanduser()
    targets = [
        RemovalTarget("HCB configuration", paths.config_dir),
        RemovalTarget("HCB local data", paths.data_dir),
        RemovalTarget("HCB cache", paths.cache_dir),
    ]
    launch_agent: Path | None = None
    if platform_label == "darwin":
        launch_agent = home_directory / "Library/LaunchAgents/com.hot-cross-buns.reminderd.plist"
        targets.extend(
            (
                RemovalTarget("HCB reminders LaunchAgent", launch_agent),
                RemovalTarget(
                    "HCB reminders log", home_directory / "Library/Logs/hcb-reminderd.log"
                ),
            )
        )

    credential_files = _credential_files(
        paths.config_dir,
        active_credential_file,
        credential_file_is_explicit,
        include_explicit_credential_file,
    )
    active = active_credential_file.expanduser()
    excluded = (
        active
        if credential_file_is_explicit
        and not include_explicit_credential_file
        and not _within(active, paths.config_dir)
        else None
    )
    if excluded is None and not _within(active, paths.config_dir):
        targets.append(RemovalTarget("HCB credential file", active))

    return UninstallPlan(
        targets=tuple(_unique_targets(targets)),
        credential_key_files=tuple(sorted(credential_files)),
        excluded_credential_file=excluded,
        package_removal=package,
        running_daemon_pid=running_daemon_pid(paths.cache_dir),
        daemon_cache_dir=paths.cache_dir,
        launch_agent_path=launch_agent,
    )


def _credential_files(
    config_dir: Path,
    active: Path,
    active_is_explicit: bool,
    include_explicit: bool,
) -> set[Path]:
    result: set[Path] = set()
    if config_dir.is_dir():
        for candidate in config_dir.rglob("*.env"):
            if candidate.is_file() and not candidate.is_symlink():
                result.add(candidate.expanduser().resolve())
    resolved_active = active.expanduser().resolve()
    if _within(resolved_active, config_dir) or not active_is_explicit or include_explicit:
        result.add(resolved_active)
    return result


def _within(path: Path, parent: Path) -> bool:
    try:
        path.expanduser().resolve().relative_to(parent.expanduser().resolve())
    except ValueError:
        return False
    return True


def _unique_targets(targets: list[RemovalTarget]) -> list[RemovalTarget]:
    result: list[RemovalTarget] = []
    for target in targets:
        _validate_target(target.path)
        if any(
            target.path.expanduser().resolve() == item.path.expanduser().resolve()
            for item in result
        ):
            continue
        result.append(target)
    return result


def _validate_target(path: Path) -> None:
    resolved = path.expanduser().resolve(strict=False)
    if resolved == resolved.parent or resolved == Path.home().resolve():
        raise ValueError(f"refusing to remove an unsafe path: {path}")


def running_daemon_pid(cache_dir: Path) -> int | None:
    """Return an active daemon PID without ever signalling that process."""

    pid_file = DaemonState(cache_dir).pid_file
    try:
        pid = int(pid_file.read_text(encoding="ascii"))
        if pid <= 0:
            return None
        os.kill(pid, 0)
    except (FileNotFoundError, OSError, ValueError):
        return None
    return pid


def execute_plan(
    plan: UninstallPlan,
    *,
    progress: RemovalProgress,
    keyring_store: TokenStore,
    platform_name: str | None = None,
) -> UninstallResult:
    """Delete the approved plan, preserving package removal until local cleanup succeeds."""

    platform_label = platform_name or sys.platform
    if plan.running_daemon_pid is not None and platform_label != "darwin":
        raise UninstallError(
            f"HCB reminders appear to be running (pid {plan.running_daemon_pid}). "
            "Stop that daemon first.",
            hint="Do not delete HCB state while a manually supervised daemon is still running.",
        )
    removed: list[str] = []
    skipped: list[str] = []

    launch_agent = plan.launch_agent_path
    if launch_agent is not None:

        def stop_launch_agent(path: Path = launch_agent) -> None:
            _stop_macos_launch_agent(path)

        progress.run("Stopping HCB reminders", stop_launch_agent)
        active_pid = running_daemon_pid(plan.daemon_cache_dir)
        if active_pid is not None:
            raise UninstallError(
                f"HCB reminders are still running (pid {active_pid}). "
                "Stop that daemon before retrying.",
                hint="HCB will not remove state while a daemon may still recreate it.",
            )

    for credential_file in plan.credential_key_files:
        label = f"Removing credential key for {credential_file.name}"

        def delete_credential_key(path: Path = credential_file) -> bool:
            return _delete_key(keyring_store, path)

        removed_key = progress.run(label, delete_credential_key)
        (removed if removed_key else skipped).append(label)

    for target in plan.targets:

        def delete_target(item: RemovalTarget = target) -> bool:
            return _remove_target(item.path)

        deleted = progress.run(f"Removing {target.label}", delete_target)
        (removed if deleted else skipped).append(target.label)

    if plan.package_removal is None:
        return UninstallResult(tuple(removed), tuple(skipped), "kept")
    package = plan.package_removal
    if os.name == "nt":
        log_path = progress.run(
            "Scheduling HCB executable removal", lambda: _schedule_windows_removal(package)
        )
        return UninstallResult(tuple(removed), tuple(skipped), "scheduled", log_path)

    progress.run("Removing the HCB executable", lambda: _run_package_removal(package))
    return UninstallResult(tuple(removed), tuple(skipped), "removed")


def _delete_key(keyring_store: TokenStore, credential_file: Path) -> bool:
    return keyring_store.delete(credential_key_account(credential_file))


def _remove_target(path: Path) -> bool:
    if not os.path.lexists(path):
        return False
    if path.is_symlink() or path.is_file():
        path.unlink()
    else:
        shutil.rmtree(path)
    return True


def _stop_macos_launch_agent(target: Path) -> None:
    subprocess.run(
        ["launchctl", "bootout", f"gui/{os.getuid()}", str(target)],
        check=False,
        capture_output=True,
        text=True,
    )


def _run_package_removal(package: PackageRemoval) -> None:
    result = subprocess.run(package.command, check=False, capture_output=True, text=True)
    if result.returncode == 0:
        return
    detail = (result.stderr or result.stdout).strip().splitlines()
    tail = "\n".join(detail[-12:])
    raise UninstallError(
        f"HCB data was removed, but {package.manager} could not remove the executable.",
        hint=tail or f"Run: {' '.join(package.command)}",
    )


def _schedule_windows_removal(package: PackageRemoval) -> Path:
    """Use the base interpreter so pipx/uv can delete HCB after this process exits."""

    base_python = Path(getattr(sys, "_base_executable", sys.executable)).resolve()
    if base_python == Path(sys.executable).resolve():
        raise UninstallError(
            "HCB cannot safely schedule its Windows executable removal from this interpreter.",
            hint=f"Run: {' '.join(package.command)}",
        )
    descriptor, log_name = tempfile.mkstemp(prefix="hcb-uninstall-", suffix=".log")
    os.close(descriptor)
    helper = """import json
import os
import subprocess
import sys
import time

parent_pid = int(sys.argv[1])
command = json.loads(sys.argv[2])
log_path = sys.argv[3]
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    try:
        os.kill(parent_pid, 0)
    except OSError:
        break
    time.sleep(0.1)
with open(log_path, "w", encoding="utf-8") as output:
    subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=False)
"""
    subprocess.Popen(
        [str(base_python), "-c", helper, str(os.getpid()), json.dumps(package.command), log_name],
        close_fds=True,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0),
    )
    return Path(log_name)
