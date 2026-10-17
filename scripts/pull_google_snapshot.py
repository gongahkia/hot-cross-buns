#!/usr/bin/env python3
"""Save a one-time, read-only snapshot of Google Calendar and Google Tasks."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
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
REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = ("CLIENT_ID", "CLIENT_SECRET")

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


def env_client_config(env_file: Path) -> dict[str, Any]:
    """Read the two Desktop client values without executing the env file."""
    if not env_file.is_file():
        raise FileNotFoundError(f"Environment file not found: {env_file}")
    values: dict[str, str] = {}
    for number, line in enumerate(env_file.read_text(encoding="utf-8-sig").splitlines(), 1):
        match = re.match(r"\s*(?:export\s+)?(CLIENT_ID|CLIENT_SECRET)\s*=\s*(.*)$", line)
        if not match:
            continue
        key, raw = match.groups()
        if key in values:
            raise SnapshotError(f"Duplicate {key} in {env_file} on line {number}")
        raw = raw.strip()
        if raw.startswith(("'", '"')):
            if len(raw) < 2 or not raw.endswith(raw[0]):
                raise SnapshotError(f"Unclosed quoted {key} in {env_file} on line {number}")
            value = raw[1:-1]
        else:
            value = re.split(r"\s+#", raw, maxsplit=1)[0].rstrip()
        if not value:
            raise SnapshotError(f"Empty {key} in {env_file} on line {number}")
        values[key] = value
    missing = [key for key in ENV_KEYS if key not in values]
    if missing:
        raise SnapshotError(f"Missing {', '.join(missing)} in {env_file}")
    return {
        "installed": {
            "client_id": values["CLIENT_ID"],
            "client_secret": values["CLIENT_SECRET"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def choose_credentials(prompt: Any = input) -> tuple[Path | None, Path | None]:
    """Prompt for a source and path when neither CLI source was supplied."""
    default = "2" if (REPO_ROOT / ".env").is_file() else "1"
    while True:
        answer = prompt(f"Credential source: [1] Desktop client JSON, [2] env file [{default}]: ").strip().lower()
        answer = answer or default
        if answer in {"1", "json"}:
            default_path = REPO_ROOT / "credentials.json"
            path = prompt(f"Desktop client JSON path [{default_path}]: ").strip()
            return Path(path).expanduser() if path else default_path, None
        if answer in {"2", "env"}:
            default_path = REPO_ROOT / ".env"
            path = prompt(f"Environment file path [{default_path}]: ").strip()
            return None, Path(path).expanduser() if path else default_path
        print("Choose 1 or 2.", file=sys.stderr)


def authenticate(credentials_file: Path | None, env_file: Path | None = None) -> Any:
    if credentials_file is not None and not credentials_file.is_file():
        raise FileNotFoundError(f"OAuth client JSON not found: {credentials_file}")
    config = env_client_config(env_file) if env_file is not None else None
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import AuthorizedSession
    except ImportError as error:
        raise SnapshotError(
            "Install the Python dependencies in scripts/google_snapshot_requirements.txt first."
        ) from error

    if config is not None:
        flow = InstalledAppFlow.from_client_config(config, [CALENDAR_SCOPE, TASKS_SCOPE])
    else:
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
            output.write('{"format":"shio-pan-google-raw-v1","exportStartedAt":')
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
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument(
        "--credentials", type=Path, help="Desktop OAuth client JSON from Google Cloud"
    )
    sources.add_argument(
        "--env-file", type=Path, help="Env file containing CLIENT_ID and CLIENT_SECRET"
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
        credentials, env_file = args.credentials, args.env_file
        if credentials is None and env_file is None:
            if not sys.stdin.isatty():
                raise SnapshotError("Choose --credentials or --env-file when running without a terminal")
            credentials, env_file = choose_credentials()
        print("Opening Google sign-in for read-only Calendar and Tasks access...", flush=True)
        session = authenticate(credentials, env_file)
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
