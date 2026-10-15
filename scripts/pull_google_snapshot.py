#!/usr/bin/env python3
"""Save a one-time, read-only snapshot of Google Calendar and Google Tasks."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Any, Iterator, TextIO
from urllib.parse import quote


CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly"
CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
TASK_LISTS_URL = "https://tasks.googleapis.com/tasks/v1/users/@me/lists"
TASKS_URL = "https://tasks.googleapis.com/tasks/v1/lists/{task_list_id}/tasks"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

CALENDAR_LIST_QUERY = {"maxResults": 250, "showHidden": True}
EVENTS_QUERY = {
    "maxResults": 2500,
    "showDeleted": True,
    "showHiddenInvitations": True,
    "singleEvents": False,
}
TASK_LISTS_QUERY = {"maxResults": 1000}
TASKS_QUERY = {
    "maxResults": 100,
    "showCompleted": True,
    "showDeleted": True,
    "showHidden": True,
    "showAssigned": True,
}


class SnapshotError(RuntimeError):
    """The API response cannot be saved as a complete snapshot."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def authenticate(credentials_file: Path) -> Any:
    if not credentials_file.is_file():
        raise FileNotFoundError(f"OAuth client JSON not found: {credentials_file}")
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import AuthorizedSession
    except ImportError as error:
        raise SnapshotError(
            "Install the Python dependencies in scripts/google_snapshot_requirements.txt first."
        ) from error

    flow = InstalledAppFlow.from_client_secrets_file(
        str(credentials_file), [CALENDAR_SCOPE, TASKS_SCOPE]
    )
    # This is deliberately one-time: no refresh token or access token is saved.
    return AuthorizedSession(flow.run_local_server(port=0))


def get_json(session: Any, url: str, params: dict[str, Any]) -> dict[str, Any]:
    for attempt in range(5):
        response = session.get(url, params=params, timeout=60)
        if response.status_code in RETRYABLE_STATUS and attempt < 4:
            retry_after = response.headers.get("Retry-After", "")
            delay = min(int(retry_after), 30) if retry_after.isdigit() else 2**attempt
            time.sleep(delay)
            continue
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise SnapshotError(f"Expected a JSON object from {url}")
        return payload
    raise AssertionError("The retry loop must return or raise")


def pages(session: Any, url: str, params: dict[str, Any]) -> Iterator[dict[str, Any]]:
    page_token: str | None = None
    seen_tokens: set[str] = set()
    while True:
        query = dict(params)
        if page_token is not None:
            query["pageToken"] = page_token
        page = get_json(session, url, query)
        if not isinstance(page.get("items", []), list):
            raise SnapshotError(f"Expected an items array from {url}")
        yield page
        next_token = page.get("nextPageToken")
        if next_token is None:
            return
        if not isinstance(next_token, str) or not next_token or next_token in seen_tokens:
            raise SnapshotError(f"Invalid or repeated pagination token from {url}")
        seen_tokens.add(next_token)
        page_token = next_token


def write_collection(
    output: TextIO,
    session: Any,
    url: str,
    query: dict[str, Any],
    collect_ids: bool = False,
) -> tuple[list[str], int]:
    output.write('{"request":')
    json.dump(query, output, ensure_ascii=False, separators=(",", ":"))
    output.write(',"pages":[')
    ids: list[str] = []
    seen_ids: set[str] = set()
    count = 0
    for index, page in enumerate(pages(session, url, query)):
        if index:
            output.write(",")
        json.dump(page, output, ensure_ascii=False, separators=(",", ":"))
        for item in page.get("items", []):
            if not isinstance(item, dict):
                raise SnapshotError(f"Expected item objects from {url}")
            count += 1
            if collect_ids:
                item_id = item.get("id")
                if not isinstance(item_id, str) or not item_id:
                    raise SnapshotError(f"A listed item from {url} has no ID")
                if item_id in seen_ids:
                    raise SnapshotError(f"Duplicate listed ID {item_id!r} from {url}")
                seen_ids.add(item_id)
                ids.append(item_id)
    output.write("]}")
    return ids, count


def export_snapshot(session: Any, destination: Path) -> dict[str, int]:
    """Write a complete snapshot atomically; never replace an existing export."""
    if destination.exists():
        raise FileExistsError(f"Output already exists: {destination}")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".google-snapshot-", suffix=".tmp", dir=destination.parent
    )
    counts: dict[str, int] = {}
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write('{"format":"hito-google-raw-v1","exportStartedAt":')
            json.dump(utc_now(), output)
            output.write(',"apis":{"calendar":"v3","tasks":"v1"},"calendarList":')
            calendar_ids, counts["calendars"] = write_collection(
                output, session, CALENDAR_LIST_URL, CALENDAR_LIST_QUERY, collect_ids=True
            )
            output.write(',"calendarEvents":[')
            counts["events"] = 0
            for index, calendar_id in enumerate(calendar_ids):
                if index:
                    output.write(",")
                output.write('{"calendarId":')
                json.dump(calendar_id, output, ensure_ascii=False)
                output.write(',"events":')
                url = CALENDAR_EVENTS_URL.format(calendar_id=quote(calendar_id, safe=""))
                _, event_count = write_collection(output, session, url, EVENTS_QUERY)
                counts["events"] += event_count
                output.write("}")
            output.write('],"taskLists":')
            task_list_ids, counts["taskLists"] = write_collection(
                output, session, TASK_LISTS_URL, TASK_LISTS_QUERY, collect_ids=True
            )
            output.write(',"tasksByList":[')
            counts["tasks"] = 0
            for index, task_list_id in enumerate(task_list_ids):
                if index:
                    output.write(",")
                output.write('{"taskListId":')
                json.dump(task_list_id, output, ensure_ascii=False)
                output.write(',"tasks":')
                url = TASKS_URL.format(task_list_id=quote(task_list_id, safe=""))
                _, task_count = write_collection(output, session, url, TASKS_QUERY)
                counts["tasks"] += task_count
                output.write("}")
            output.write('],"exportFinishedAt":')
            json.dump(utc_now(), output)
            output.write("}\n")
            output.flush()
            os.fsync(output.fileno())
        # A hard link publishes the complete file without replacing a prior export.
        os.link(temporary_name, destination)
    finally:
        os.unlink(temporary_name)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--credentials", required=True, type=Path, help="Desktop OAuth client JSON from Google Cloud"
    )
    parser.add_argument(
        "--output", type=Path,
        help="Snapshot JSON path (default: .local/google-snapshot-<UTC timestamp>.json)",
    )
    args = parser.parse_args()
    destination = args.output or Path(".local") / (
        f"google-snapshot-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    )
    try:
        if destination.exists():
            raise FileExistsError(f"Output already exists: {destination}")
        session = authenticate(args.credentials)
        counts = export_snapshot(session, destination)
    except Exception as error:
        print(f"Google snapshot failed: {error}", file=sys.stderr)
        return 1
    print(f"Saved {destination}")
    print(
        f"{counts['calendars']} calendars, {counts['events']} events, "
        f"{counts['taskLists']} task lists, {counts['tasks']} tasks"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
