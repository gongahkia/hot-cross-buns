from __future__ import annotations

from subprocess import CompletedProcess

import pytest

from hcb.notifications import (
    MacOSNotifier,
    NoOpNotifier,
    Notification,
    NotificationAction,
    NotificationPermissionError,
)


def test_macos_uses_argv_without_shell_interpolation(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[list[str], dict[str, object]]] = []

    def run(argv: list[str], **kwargs: object) -> CompletedProcess[str]:
        calls.append((argv, kwargs))
        return CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr("hcb.notifications.subprocess.run", run)
    action = MacOSNotifier().notify(
        Notification('"; do shell script "bad', "$(touch /tmp/x)", "id")
    )
    assert action is NotificationAction.DELIVERED
    argv, kwargs = calls[0]
    assert argv[-2:] == ['"; do shell script "bad', "$(touch /tmp/x)"]
    assert kwargs["check"] is False
    assert "shell" not in kwargs


def test_macos_permission_denial_is_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "hcb.notifications.subprocess.run",
        lambda *args, **kwargs: CompletedProcess(args[0], 1, "", "Not authorized to send"),
    )
    with pytest.raises(NotificationPermissionError):
        MacOSNotifier().notify(Notification("title", "body", "id"))


def test_noop_adapter_is_portable() -> None:
    assert (
        NoOpNotifier().notify(Notification("title", "body", "id")) is NotificationAction.DELIVERED
    )
