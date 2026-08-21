"""Portable local notification adapters."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class NotificationAction(StrEnum):
    DELIVERED = "delivered"
    SNOOZE = "snooze"
    DISMISS = "dismiss"


class NotificationPermissionError(RuntimeError):
    """The operating system denied notification delivery."""


@dataclass(frozen=True, slots=True)
class Notification:
    title: str
    body: str
    identifier: str


class Notifier(Protocol):
    def notify(self, notification: Notification) -> NotificationAction: ...


class MacOSNotifier:
    """Post through AppleScript without shell parsing or source interpolation."""

    _SCRIPT = (
        "on run argv\n"
        'set answer to display dialog (item 2 of argv) with title (item 1 of argv) '
        'buttons {"Dismiss", "Snooze 10m"} default button "Dismiss" giving up after 30\n'
        'if gave up of answer then return "delivered"\n'
        "return button returned of answer\n"
        "end run"
    )

    def notify(self, notification: Notification) -> NotificationAction:
        result = subprocess.run(
            ["/usr/bin/osascript", "-e", self._SCRIPT, "--", notification.title, notification.body],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            detail = result.stderr.strip().lower()
            if "not authorized" in detail or "not permitted" in detail or "denied" in detail:
                raise NotificationPermissionError("macOS notification permission was denied")
            raise RuntimeError(f"macOS notification delivery failed (exit {result.returncode})")
        if result.stdout.strip() == "Snooze 10m":
            return NotificationAction.SNOOZE
        if result.stdout.strip() == "Dismiss":
            return NotificationAction.DISMISS
        return NotificationAction.DELIVERED


class ConsoleNotifier:
    def notify(self, notification: Notification) -> NotificationAction:
        print(f"{notification.title}: {notification.body}", file=sys.stderr)
        return NotificationAction.DELIVERED


class NoOpNotifier:
    def notify(self, notification: Notification) -> NotificationAction:
        return NotificationAction.DELIVERED


def default_notifier() -> Notifier:
    return MacOSNotifier() if sys.platform == "darwin" else ConsoleNotifier()
