"""Typed boundary around the Google Tasks, Calendar, and Drive APIs."""

from __future__ import annotations

import json
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, cast

from .errors import GoogleApiError

Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class Page:
    items: tuple[Json, ...]
    next_page_token: str | None = None
    next_sync_token: str | None = None


class GoogleGateway(Protocol):
    """Network contract used by sync; fakes can implement it without Google packages."""

    def list_task_lists(self, *, page_token: str | None = None) -> Page: ...
    def list_tasks(
        self, task_list_id: str, *, page_token: str | None = None, updated_min: str | None = None
    ) -> Page: ...
    def list_calendars(
        self, *, page_token: str | None = None, sync_token: str | None = None
    ) -> Page: ...
    def list_events(
        self,
        calendar_id: str,
        *,
        page_token: str | None = None,
        sync_token: str | None = None,
        time_min: str | None = None,
        time_max: str | None = None,
        single_events: bool = False,
    ) -> Page: ...

    def create_task_list(self, body: Json) -> Json: ...
    def update_task_list(
        self, task_list_id: str, body: Json, *, etag: str | None = None
    ) -> Json: ...
    def delete_task_list(self, task_list_id: str, *, etag: str | None = None) -> None: ...
    def create_task(self, task_list_id: str, body: Json) -> Json: ...
    def update_task(
        self, task_list_id: str, task_id: str, body: Json, *, etag: str | None = None
    ) -> Json: ...
    def delete_task(
        self, task_list_id: str, task_id: str, *, etag: str | None = None
    ) -> None: ...
    def move_task(
        self,
        task_list_id: str,
        task_id: str,
        *,
        parent: str | None = None,
        previous: str | None = None,
    ) -> Json: ...

    def create_event(self, calendar_id: str, body: Json) -> Json: ...
    def update_event(
        self, calendar_id: str, event_id: str, body: Json, *, etag: str | None = None
    ) -> Json: ...
    def delete_event(
        self, calendar_id: str, event_id: str, *, etag: str | None = None
    ) -> None: ...
    def move_event(self, calendar_id: str, event_id: str, destination: str) -> Json: ...
    def respond_event(
        self,
        calendar_id: str,
        event_id: str,
        response_status: str,
        *,
        etag: str | None = None,
    ) -> Json: ...

    def create_calendar(self, body: Json) -> Json: ...
    def update_calendar(
        self, calendar_id: str, body: Json, *, etag: str | None = None
    ) -> Json: ...
    def delete_calendar(self, calendar_id: str, *, etag: str | None = None) -> None: ...
    def freebusy(self, body: Json) -> Json: ...
    def drive_metadata(self, file_id: str, *, fields: str = "*") -> Json: ...


def _error_from_http(exc: BaseException) -> GoogleApiError:
    response = getattr(exc, "resp", None)
    status = int(getattr(response, "status", 0) or 0)
    retry_after: float | None = None
    headers = response if isinstance(response, Mapping) else {}
    raw_retry = headers.get("retry-after") or headers.get("Retry-After")
    if raw_retry is not None:
        with suppress(TypeError, ValueError):
            retry_after = float(raw_retry)
    reason: str | None = None
    message = f"Google API request failed ({status or 'unknown status'})"
    content = getattr(exc, "content", b"")
    try:
        payload = json.loads(content.decode() if isinstance(content, bytes) else content)
        error = payload.get("error", payload)
        message = str(error.get("message") or message)
        errors = error.get("errors") or ()
        if errors:
            reason = errors[0].get("reason")
        reason = reason or error.get("status")
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        pass
    return GoogleApiError(status, message, reason=reason, retry_after=retry_after)


class GoogleApiClient:
    """google-api-python-client adapter. Construction itself performs no network I/O."""

    def __init__(
        self,
        credentials: Any | None = None,
        *,
        tasks_service: Any | None = None,
        calendar_service: Any | None = None,
        drive_service: Any | None = None,
    ) -> None:
        if tasks_service is None or calendar_service is None or drive_service is None:
            from googleapiclient.discovery import build  # type: ignore[import-untyped]

            tasks_service = tasks_service or build(
                "tasks", "v1", credentials=credentials, cache_discovery=False
            )
            calendar_service = calendar_service or build(
                "calendar", "v3", credentials=credentials, cache_discovery=False
            )
            drive_service = drive_service or build(
                "drive", "v3", credentials=credentials, cache_discovery=False
            )
        self.tasks = tasks_service
        self.calendar = calendar_service
        self.drive = drive_service

    @staticmethod
    def _execute(request: Any, *, etag: str | None = None) -> Json:
        if etag:
            request.headers["If-Match"] = etag
        try:
            return cast(Json, request.execute())
        except Exception as exc:
            if hasattr(exc, "resp"):
                raise _error_from_http(exc) from exc
            raise

    @classmethod
    def _void(cls, request: Any, *, etag: str | None = None) -> None:
        cls._execute(request, etag=etag)

    @staticmethod
    def _page(response: Json) -> Page:
        return Page(
            tuple(response.get("items", ())),
            response.get("nextPageToken"),
            response.get("nextSyncToken"),
        )

    def list_task_lists(self, *, page_token: str | None = None) -> Page:
        return self._page(self._execute(self.tasks.tasklists().list(pageToken=page_token)))

    def list_tasks(
        self, task_list_id: str, *, page_token: str | None = None, updated_min: str | None = None
    ) -> Page:
        request = self.tasks.tasks().list(
            tasklist=task_list_id,
            pageToken=page_token,
            updatedMin=updated_min,
            showCompleted=True,
            showDeleted=True,
            showHidden=True,
        )
        return self._page(self._execute(request))

    def list_calendars(
        self, *, page_token: str | None = None, sync_token: str | None = None
    ) -> Page:
        return self._page(
            self._execute(
                self.calendar.calendarList().list(
                    pageToken=page_token,
                    syncToken=sync_token,
                    showDeleted=True,
                    showHidden=True,
                )
            )
        )

    def list_events(
        self,
        calendar_id: str,
        *,
        page_token: str | None = None,
        sync_token: str | None = None,
        time_min: str | None = None,
        time_max: str | None = None,
        single_events: bool = False,
    ) -> Page:
        response = self._execute(
            self.calendar.events().list(
                calendarId=calendar_id,
                pageToken=page_token,
                syncToken=sync_token,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=single_events,
                showDeleted=True,
            )
        )
        return self._page(response)

    def create_task_list(self, body: Json) -> Json:
        return self._execute(self.tasks.tasklists().insert(body=body))

    def update_task_list(self, task_list_id: str, body: Json, *, etag: str | None = None) -> Json:
        return self._execute(
            self.tasks.tasklists().patch(tasklist=task_list_id, body=body), etag=etag
        )

    def delete_task_list(self, task_list_id: str, *, etag: str | None = None) -> None:
        self._void(self.tasks.tasklists().delete(tasklist=task_list_id), etag=etag)

    def create_task(self, task_list_id: str, body: Json) -> Json:
        return self._execute(self.tasks.tasks().insert(tasklist=task_list_id, body=body))

    def update_task(
        self, task_list_id: str, task_id: str, body: Json, *, etag: str | None = None
    ) -> Json:
        return self._execute(
            self.tasks.tasks().patch(tasklist=task_list_id, task=task_id, body=body), etag=etag
        )

    def delete_task(
        self, task_list_id: str, task_id: str, *, etag: str | None = None
    ) -> None:
        self._void(
            self.tasks.tasks().delete(tasklist=task_list_id, task=task_id), etag=etag
        )

    def move_task(
        self,
        task_list_id: str,
        task_id: str,
        *,
        parent: str | None = None,
        previous: str | None = None,
    ) -> Json:
        return self._execute(
            self.tasks.tasks().move(
                tasklist=task_list_id, task=task_id, parent=parent, previous=previous
            )
        )

    def create_event(self, calendar_id: str, body: Json) -> Json:
        return self._execute(self.calendar.events().insert(calendarId=calendar_id, body=body))

    def update_event(
        self, calendar_id: str, event_id: str, body: Json, *, etag: str | None = None
    ) -> Json:
        return self._execute(
            self.calendar.events().patch(
                calendarId=calendar_id, eventId=event_id, body=body
            ),
            etag=etag,
        )

    def delete_event(
        self, calendar_id: str, event_id: str, *, etag: str | None = None
    ) -> None:
        self._void(
            self.calendar.events().delete(calendarId=calendar_id, eventId=event_id),
            etag=etag,
        )

    def move_event(self, calendar_id: str, event_id: str, destination: str) -> Json:
        return self._execute(
            self.calendar.events().move(
                calendarId=calendar_id,
                eventId=event_id,
                destination=destination,
            )
        )

    def respond_event(
        self,
        calendar_id: str,
        event_id: str,
        response_status: str,
        *,
        etag: str | None = None,
    ) -> Json:
        body = {"attendees": [{"self": True, "responseStatus": response_status}]}
        return self.update_event(calendar_id, event_id, body, etag=etag)

    def create_calendar(self, body: Json) -> Json:
        return self._execute(self.calendar.calendars().insert(body=body))

    def update_calendar(
        self, calendar_id: str, body: Json, *, etag: str | None = None
    ) -> Json:
        return self._execute(
            self.calendar.calendars().patch(calendarId=calendar_id, body=body), etag=etag
        )

    def delete_calendar(self, calendar_id: str, *, etag: str | None = None) -> None:
        self._void(self.calendar.calendars().delete(calendarId=calendar_id), etag=etag)

    def freebusy(self, body: Json) -> Json:
        return self._execute(self.calendar.freebusy().query(body=body))

    def drive_metadata(self, file_id: str, *, fields: str = "*") -> Json:
        return self._execute(self.drive.files().get(fileId=file_id, fields=fields))


def rfc3339(value: datetime) -> str:
    """Google accepts ISO 8601; normalize UTC's suffix for stable requests."""
    return value.isoformat().replace("+00:00", "Z")
