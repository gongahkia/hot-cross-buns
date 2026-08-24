"""Resumable, account-partitioned synchronization with Google."""

from __future__ import annotations

import hashlib
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import TypeVar

from .errors import (
    AuthenticationRequired,
    GoogleApiError,
    RequestNotSentError,
    TransientTransportError,
)
from .google_client import GoogleGateway, Json, Page, rfc3339
from .models import (
    Calendar,
    Conflict,
    DateTimeKind,
    EntityType,
    Event,
    EventDateTime,
    EventStatus,
    Metadata,
    MutationOperation,
    OutboxDeliveryState,
    PendingMutation,
    ReminderOverride,
    SyncCursor,
    Task,
    TaskList,
    TaskStatus,
    utc_now,
)
from .storage import Storage

RATE_LIMIT_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}
T = TypeVar("T")


def _ignore_progress(_: str) -> None:
    """Default progress callback for non-interactive callers."""


def _not_cancelled() -> bool:
    return False


@dataclass(frozen=True, slots=True)
class _RetryContext:
    progress: Callable[[str], None]
    cancelled: Callable[[], bool]
    cancel_hint: str


class _RetryCancelled(Exception):
    """Internal signal used to leave a retry wait without another request."""


class _RetryExhausted(Exception):
    """Internal signal carrying the final retryable failure."""

    def __init__(self, operation: str, error: Exception, retry_after: float) -> None:
        super().__init__(f"{operation} could not complete after bounded retries: {error}")
        self.operation = operation
        self.error = error
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class SyncResult:
    pages: int = 0
    pulled: int = 0
    pushed: int = 0
    conflicts: int = 0
    retry_pending: bool = False
    retry_after: float | None = None
    retry_exhausted: bool = False
    cancelled: bool = False
    retry_message: str | None = None

    def plus(self, other: SyncResult) -> SyncResult:
        delays = [value for value in (self.retry_after, other.retry_after) if value is not None]
        return SyncResult(
            pages=self.pages + other.pages,
            pulled=self.pulled + other.pulled,
            pushed=self.pushed + other.pushed,
            conflicts=self.conflicts + other.conflicts,
            retry_pending=self.retry_pending or other.retry_pending,
            retry_after=max(delays) if delays else None,
            retry_exhausted=self.retry_exhausted or other.retry_exhausted,
            cancelled=self.cancelled or other.cancelled,
            retry_message=other.retry_message or self.retry_message,
        )


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _metadata(item: Json, *, deleted: bool = False) -> Metadata:
    return Metadata(
        etag=item.get("etag"),
        remote_updated_at=_parse_datetime(item.get("updated")),
        deleted=deleted,
    )


def _event_time(value: Json) -> EventDateTime:
    if "date" in value:
        return EventDateTime(DateTimeKind.DATE, date.fromisoformat(value["date"]))
    parsed = _parse_datetime(value.get("dateTime"))
    if parsed is None:
        raise ValueError("Google event has no date or dateTime")
    return EventDateTime(DateTimeKind.DATETIME, parsed, value.get("timeZone"))


def task_list_from_google(account_id: str, item: Json, *, local_id: str | None = None) -> TaskList:
    remote_id = str(item["id"])
    return TaskList(
        local_id or remote_id,
        account_id,
        item.get("title", ""),
        remote_id,
        metadata=_metadata(item, deleted=bool(item.get("deleted"))),
    )


def task_from_google(
    account_id: str, list_id: str, item: Json, *, local_id: str | None = None
) -> Task:
    remote_id = str(item["id"])
    due = _parse_datetime(item.get("due"))
    return Task(
        id=local_id or remote_id,
        account_id=account_id,
        list_id=list_id,
        title=item.get("title", ""),
        notes=item.get("notes"),
        status=TaskStatus(item.get("status", TaskStatus.NEEDS_ACTION.value)),
        due=due.date() if due else None,
        completed_at=_parse_datetime(item.get("completed")),
        parent_id=item.get("parent"),
        position=item.get("position"),
        remote_id=remote_id,
        metadata=_metadata(item, deleted=bool(item.get("deleted"))),
    )


def calendar_from_google(account_id: str, item: Json, *, local_id: str | None = None) -> Calendar:
    remote_id = str(item["id"])
    return Calendar(
        id=local_id or remote_id,
        account_id=account_id,
        summary=item.get("summary", ""),
        remote_id=remote_id,
        description=item.get("description"),
        time_zone=item.get("timeZone"),
        color=item.get("backgroundColor") or item.get("colorId"),
        foreground_color=item.get("foregroundColor"),
        location=item.get("location"),
        summary_override=item.get("summaryOverride"),
        hidden=bool(item.get("hidden", False)),
        selected=bool(item.get("selected", True)),
        metadata=_metadata(item, deleted=bool(item.get("deleted"))),
        default_reminders=tuple(
            ReminderOverride(str(value.get("method", "")), int(value.get("minutes", 0)))
            for value in item.get("defaultReminders") or ()
            if isinstance(value, dict)
        ),
        notification_settings=tuple(
            value
            for value in ((item.get("notificationSettings") or {}).get("notifications") or ())
            if isinstance(value, dict)
        ),
    )


def event_from_google(
    account_id: str,
    calendar_id: str,
    item: Json,
    *,
    local_id: str | None = None,
    derived: bool = False,
) -> Event:
    remote_id = str(item["id"])
    original = item.get("originalStartTime") or {}
    occurrence_id = original.get("dateTime") or original.get("date")
    reminders = item.get("reminders") or {}
    attendees = tuple(value for value in item.get("attendees") or () if isinstance(value, dict))
    own_attendee = next((value for value in attendees if value.get("self")), None)
    return Event(
        id=local_id or (f"{remote_id}@{occurrence_id}" if occurrence_id else remote_id),
        account_id=account_id,
        calendar_id=calendar_id,
        summary=item.get("summary", ""),
        start=_event_time(item["start"]),
        end=_event_time(item["end"]),
        remote_id=remote_id,
        canonical_id=item.get("recurringEventId"),
        occurrence_id=occurrence_id,
        description=item.get("description"),
        location=item.get("location"),
        status=EventStatus(item.get("status", EventStatus.CONFIRMED.value)),
        recurrence=tuple(item.get("recurrence") or ()),
        derived=derived,
        metadata=_metadata(item, deleted=item.get("status") == "cancelled"),
        reminder_use_default=bool(reminders.get("useDefault", True)),
        reminder_overrides=tuple(
            ReminderOverride(str(value.get("method", "")), int(value.get("minutes", 0)))
            for value in reminders.get("overrides") or ()
            if isinstance(value, dict)
        ),
        attendees=attendees,
        attendee_response=own_attendee.get("responseStatus") if own_attendee else None,
        event_type=item.get("eventType"),
        transparency=item.get("transparency"),
        visibility=item.get("visibility"),
        color_id=item.get("colorId"),
        attachments=tuple(
            value for value in item.get("attachments") or () if isinstance(value, dict)
        ),
        conference=item.get("conferenceData")
        if isinstance(item.get("conferenceData"), dict)
        else None,
        guests_can_invite_others=item.get("guestsCanInviteOthers"),
        guests_can_modify=item.get("guestsCanModify"),
        guests_can_see_other_guests=item.get("guestsCanSeeOtherGuests"),
        anyone_can_add_self=item.get("anyoneCanAddSelf"),
        focus_time_properties=(
            item.get("focusTimeProperties")
            if isinstance(item.get("focusTimeProperties"), dict)
            else None
        ),
        out_of_office_properties=(
            item.get("outOfOfficeProperties")
            if isinstance(item.get("outOfOfficeProperties"), dict)
            else None
        ),
        working_location_properties=(
            item.get("workingLocationProperties")
            if isinstance(item.get("workingLocationProperties"), dict)
            else None
        ),
    )


def _clean_body(payload: Json) -> Json:
    return dict(payload.get("body", payload))


def _required_remote(value: object, entity: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{entity} has no remote id")
    return value


class SyncEngine:
    def __init__(
        self,
        storage: Storage,
        gateway: GoogleGateway,
        *,
        now: Callable[[], datetime] = utc_now,
        crash_hook: Callable[[str, PendingMutation], None] | None = None,
        max_retries: int = 4,
        base_retry_delay: float = 1.0,
        max_retry_delay: float = 32.0,
        random_source: Callable[[], float] = random.random,
        wait_for_retry: Callable[[float, Callable[[], bool]], bool] | None = None,
    ) -> None:
        if max_retries < 1:
            raise ValueError("max_retries must be at least one")
        if base_retry_delay <= 0 or max_retry_delay < base_retry_delay:
            raise ValueError("retry delays must be positive and ordered")
        self.storage = storage
        self.gateway = gateway
        self.now = now
        self.crash_hook = crash_hook or (lambda _phase, _mutation: None)
        self.max_retries = max_retries
        self.base_retry_delay = base_retry_delay
        self.max_retry_delay = max_retry_delay
        self.random_source = random_source
        self.wait_for_retry = wait_for_retry or self._wait_for_retry

    @staticmethod
    def _wait_for_retry(delay: float, cancelled: Callable[[], bool]) -> bool:
        """Wait in short intervals so a TUI cancellation is observed promptly."""
        deadline = time.monotonic() + delay
        while True:
            if cancelled():
                return False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return True
            time.sleep(min(0.1, remaining))

    @staticmethod
    def _transient(error: Exception) -> bool:
        if isinstance(error, (RequestNotSentError, TransientTransportError)):
            return True
        return isinstance(error, GoogleApiError) and (
            error.retryable
            or (error.status == 403 and error.reason in RATE_LIMIT_REASONS)
        )

    def _retry_delay(self, error: Exception, retry: int) -> float:
        retry_after = error.retry_after if isinstance(error, GoogleApiError) else None
        backoff = min(self.max_retry_delay, self.base_retry_delay * (2 ** (retry - 1)))
        jitter = min(1.0, max(0.0, self.random_source()))
        return max(retry_after or 0.0, backoff + jitter)

    @staticmethod
    def _check_cancel(context: _RetryContext) -> None:
        if context.cancelled():
            raise _RetryCancelled

    def _retry_call(
        self,
        operation: str,
        call: Callable[[], T],
        context: _RetryContext,
        *,
        safe_to_retry: Callable[[Exception], bool] | None = None,
    ) -> T:
        """Retry a transient request serially, without replaying unsafe creates."""
        retry = 0
        while True:
            self._check_cancel(context)
            try:
                return call()
            except (RequestNotSentError, TransientTransportError, GoogleApiError) as error:
                if not self._transient(error) or (
                    safe_to_retry is not None and not safe_to_retry(error)
                ):
                    raise
                if retry >= self.max_retries:
                    raise _RetryExhausted(
                        operation, error, self._retry_delay(error, retry + 1)
                    ) from error
                retry += 1
                delay = self._retry_delay(error, retry)
                context.progress(
                    f"{operation} temporarily failed; retrying {retry}/{self.max_retries} "
                    f"in {delay:.1f}s. {context.cancel_hint}"
                )
                if not self.wait_for_retry(delay, context.cancelled):
                    raise _RetryCancelled from None

    def _retry_context(
        self,
        progress: Callable[[str], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
        cancel_hint: str = "Press Ctrl+C to cancel.",
    ) -> _RetryContext:
        return _RetryContext(progress or _ignore_progress, cancelled or _not_cancelled, cancel_hint)

    def sync(
        self,
        account_id: str,
        *,
        progress: Callable[[str], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
        cancel_hint: str = "Press Ctrl+C to cancel.",
    ) -> SyncResult:
        """Synchronize an account and report completed stages when requested."""

        if self.storage.get_account(account_id) is None:
            raise ValueError(f"unknown account {account_id!r}")
        context = self._retry_context(progress, cancelled, cancel_hint)
        result = SyncResult()
        try:
            self._check_cancel(context)
            context.progress("Sending local changes")
            result = self.flush_outbox(account_id, context=context)
            if result.retry_pending or result.cancelled:
                return result
            context.progress("Fetching task lists")
            result = result.plus(
                self.sync_task_lists(account_id, progress=context.progress, context=context)
            )
            context.progress("Fetching calendars")
            result = result.plus(
                self.sync_calendars(account_id, progress=context.progress, context=context)
            )
            context.progress("Finishing sync")
            return result
        except _RetryCancelled:
            return result.plus(
                SyncResult(
                    cancelled=True,
                    retry_message=(
                        "Sync cancelled. Local changes remain queued; run sync to resume."
                    ),
                )
            )
        except _RetryExhausted as error:
            return result.plus(
                SyncResult(
                    retry_pending=True,
                    retry_after=error.retry_after,
                    retry_exhausted=True,
                    retry_message=(
                        f"{error.operation} paused after bounded retries. "
                        "Local changes remain queued; run sync to resume."
                    ),
                )
            )

    def _paged(
        self,
        account_id: str,
        scope: str,
        fetch: Callable[[str | None], Page],
        apply: Callable[[Json], None],
        *,
        final_cursor_scope: str | None = None,
        context: _RetryContext | None = None,
    ) -> SyncResult:
        context = context or self._retry_context()
        resumed = self.storage.resumable_checkpoint(account_id, scope)
        checkpoint, token = resumed or (self.storage.start_checkpoint(account_id, scope), None)
        pages = pulled = 0
        try:
            while True:
                page = self._retry_call(
                    f"Fetching {scope}", lambda token=token: fetch(token), context
                )
                with self.storage.transaction():
                    for item in page.items:
                        apply(item)
                    pages += 1
                    pulled += len(page.items)
                    token = page.next_page_token
                    if token is not None:
                        self.storage.save_checkpoint_page(checkpoint, token)
                    else:
                        if final_cursor_scope is not None:
                            self.storage.set_cursor(
                                SyncCursor(account_id, final_cursor_scope, page.next_sync_token)
                            )
                        self.storage.finish_checkpoint(checkpoint, cursor=page.next_sync_token)
                if token is None:
                    break
        except Exception as exc:
            # The incomplete checkpoint deliberately retains its next page token.
            self.storage.connection.execute(
                "UPDATE sync_checkpoints SET error=? WHERE id=?", (str(exc), checkpoint)
            )
            raise
        return SyncResult(pages=pages, pulled=pulled)

    def sync_task_lists(
        self,
        account_id: str,
        *,
        progress: Callable[[str], None] | None = None,
        context: _RetryContext | None = None,
    ) -> SyncResult:
        context = context or self._retry_context(progress)
        def apply(item: Json) -> None:
            existing = self.storage.get_task_list_by_remote(account_id, str(item["id"]))
            if existing is None or not existing.metadata.dirty:
                self.storage.upsert_task_list(
                    task_list_from_google(
                        account_id, item, local_id=existing.id if existing else None
                    )
                )

        result = self._paged(
            account_id,
            "task-lists",
            lambda token: self.gateway.list_task_lists(page_token=token),
            apply,
            context=context,
        )
        report = context.progress
        task_lists = [item for item in self.storage.list_task_lists(account_id) if item.remote_id]
        for index, task_list in enumerate(task_lists, start=1):
            report(f"Fetching tasks {index}/{len(task_lists)}")
            result = result.plus(self.sync_tasks(account_id, task_list, context=context))
        return result

    def sync_tasks(
        self,
        account_id: str,
        task_list: TaskList,
        *,
        context: _RetryContext | None = None,
    ) -> SyncResult:
        context = context or self._retry_context()
        assert task_list.remote_id is not None
        remote_list_id = task_list.remote_id
        scope = f"tasks:{remote_list_id}"
        cursor = self.storage.get_cursor(account_id, scope)
        updated_min: str | None = None
        if cursor and cursor.cursor:
            last = _parse_datetime(cursor.cursor)
            if last:
                updated_min = rfc3339(last - timedelta(minutes=5))
        completed_at = rfc3339(self.now())

        def apply(item: Json) -> None:
            existing = self.storage.get_task_by_remote(account_id, str(item["id"]))
            if existing is None or not existing.metadata.dirty:
                self.storage.upsert_task(
                    task_from_google(
                        account_id,
                        task_list.id,
                        item,
                        local_id=existing.id if existing else None,
                    )
                )

        result = self._paged(
            account_id,
            scope,
            lambda token: self.gateway.list_tasks(
                remote_list_id, page_token=token, updated_min=updated_min
            ),
            apply,
            context=context,
        )
        self.storage.set_cursor(SyncCursor(account_id, scope, completed_at))
        return result

    def sync_calendars(
        self,
        account_id: str,
        *,
        progress: Callable[[str], None] | None = None,
        context: _RetryContext | None = None,
    ) -> SyncResult:
        context = context or self._retry_context(progress)
        def apply(item: Json) -> None:
            existing = self.storage.get_calendar_by_remote(account_id, str(item["id"]))
            if existing is None or not existing.metadata.dirty:
                self.storage.upsert_calendar(
                    calendar_from_google(
                        account_id, item, local_id=existing.id if existing else None
                    )
                )

        scope = "calendar-list"
        cursor = self.storage.get_cursor(account_id, scope)
        reset = False
        while True:
            initial_token = cursor.cursor if cursor else None

            def fetch(token: str | None, *, initial: str | None = initial_token) -> Page:
                return self.gateway.list_calendars(
                    page_token=token, sync_token=None if token else initial
                )

            try:
                result = self._paged(
                    account_id,
                    scope,
                    fetch,
                    apply,
                    final_cursor_scope=scope,
                    context=context,
                )
                break
            except GoogleApiError as exc:
                if exc.status != 410 or reset:
                    raise
                with self.storage.transaction():
                    self.storage.delete_cursor(account_id, scope)
                    stale = self.storage.resumable_checkpoint(account_id, scope)
                    if stale:
                        self.storage.finish_checkpoint(stale[0], error="sync token expired")
                cursor = None
                reset = True
        report = context.progress
        calendars = [
            item
            for item in self.storage.list_calendars(account_id)
            if item.remote_id and item.selected
        ]
        for index, calendar in enumerate(calendars, start=1):
            report(f"Fetching calendar {index}/{len(calendars)}")
            result = result.plus(self.sync_events(account_id, calendar, context=context))
        return result

    def sync_events(
        self,
        account_id: str,
        calendar: Calendar,
        *,
        context: _RetryContext | None = None,
    ) -> SyncResult:
        context = context or self._retry_context()
        assert calendar.remote_id is not None
        remote_calendar_id = calendar.remote_id
        scope = f"events:{remote_calendar_id}"
        cursor = self.storage.get_cursor(account_id, scope)

        def apply(item: Json) -> None:
            existing = self.storage.get_event_by_remote(account_id, str(item["id"]))
            affects_instance_cache = bool(
                item.get("recurrence")
                or item.get("recurringEventId")
                or item.get("originalStartTime")
                or (existing and (existing.recurrence or existing.is_occurrence))
            )
            if item.get("status") == "cancelled" and ("start" not in item or "end" not in item):
                if existing and not existing.metadata.dirty:
                    self.storage.upsert_event(
                        replace(existing, metadata=replace(existing.metadata, deleted=True))
                    )
                if affects_instance_cache:
                    self.storage.mark_instance_ranges_stale(
                        account_id, calendar.id, reason="remote-recurring-event-changed"
                    )
                return
            if existing is None or not existing.metadata.dirty:
                self.storage.upsert_event(
                    event_from_google(
                        account_id,
                        calendar.id,
                        item,
                        local_id=existing.id if existing else None,
                    )
                )
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, calendar.id, reason="remote-recurring-event-changed"
                )

        reset = False
        while True:
            sync_token = cursor.cursor if cursor else None

            def fetch(token: str | None, *, initial: str | None = sync_token) -> Page:
                return self.gateway.list_events(
                    remote_calendar_id,
                    page_token=token,
                    sync_token=None if token else initial,
                    single_events=False,
                )

            try:
                return self._paged(
                    account_id,
                    scope,
                    fetch,
                    apply,
                    final_cursor_scope=scope,
                    context=context,
                )
            except GoogleApiError as exc:
                if exc.status != 410 or reset:
                    raise
                # A Calendar sync token expires independently of every other calendar.
                with self.storage.transaction():
                    self.storage.delete_cursor(account_id, scope)
                    self.storage.clear_calendar_mirror(account_id, calendar.id)
                    stale = self.storage.resumable_checkpoint(account_id, scope)
                    if stale:
                        self.storage.finish_checkpoint(stale[0], error="sync token expired")
                cursor = None
                reset = True

    def refresh_occurrences(
        self, account_id: str, calendar_id: str, start: datetime, end: datetime
    ) -> list[Event]:
        """Fetch an explicit remote range and persist recurring instances locally."""
        calendar = self.storage.get_calendar(account_id, calendar_id)
        if calendar is None or calendar.remote_id is None:
            raise ValueError("calendar is not synchronized")
        token: str | None = None
        result: list[Event] = []
        while True:
            page = self.gateway.list_events(
                calendar.remote_id,
                page_token=token,
                time_min=rfc3339(start),
                time_max=rfc3339(end),
                single_events=True,
            )
            for item in page.items:
                if "start" in item and "end" in item and item.get("recurringEventId"):
                    result.append(event_from_google(account_id, calendar.id, item, derived=True))
            token = page.next_page_token
            if token is None:
                with self.storage.transaction():
                    self.storage.replace_cached_instances(
                        account_id, calendar.id, start, end, result
                    )
                return result

    def load_occurrences(
        self, account_id: str, calendar_id: str, start: datetime, end: datetime
    ) -> list[Event]:
        """Backward-compatible name for the explicit, caching occurrence refresh."""
        return self.refresh_occurrences(account_id, calendar_id, start, end)

    @staticmethod
    def _non_idempotent_create(mutation: PendingMutation) -> bool:
        if mutation.operation is MutationOperation.CREATE and mutation.entity_type in {
            EntityType.TASK,
            EntityType.TASK_LIST,
            EntityType.CALENDAR,
        }:
            return True
        # A cross-list Google Tasks move is sent to the source list. After a
        # response is lost, repeating it may target a task that has already
        # left that source, so require explicit delivery resolution instead.
        return (
            mutation.entity_type is EntityType.TASK
            and mutation.operation is MutationOperation.MOVE
            and bool(mutation.payload.get("source_list_id"))
            and mutation.payload.get("source_list_id") != mutation.payload.get("list_id")
        )

    @staticmethod
    def _event_request_id(mutation: PendingMutation) -> str:
        identity = (
            f"{mutation.account_id}\0{mutation.entity_type.value}\0"
            f"{mutation.entity_id}\0{mutation.operation.value}"
        )
        # Google Calendar event IDs accept base32hex characters. A SHA-256 hex
        # prefix is therefore valid, deterministic, and safely below its limit.
        return "hcb" + hashlib.sha256(identity.encode()).hexdigest()[:40]

    @staticmethod
    def _uncertain_payload(mutation: PendingMutation) -> Json:
        return {
            "kind": "uncertain-delivery",
            "mutation": {
                "entity_type": mutation.entity_type.value,
                "entity_id": mutation.entity_id,
                "operation": mutation.operation.value,
                "payload": mutation.payload,
                "request_id": mutation.request_id,
            },
        }

    def _quarantine_uncertain_create(self, mutation: PendingMutation, reason: str) -> None:
        assert mutation.id is not None
        with self.storage.transaction():
            self.storage.add_conflict(
                Conflict(
                    None,
                    mutation.account_id,
                    mutation.entity_type,
                    mutation.entity_id,
                    self._uncertain_payload(mutation),
                    {
                        "kind": "delivery-status-unknown",
                        "reason": reason,
                        "required_action": "verify Google, then choose delivered or retry",
                    },
                )
            )
            self.storage.complete_mutation(mutation.account_id, mutation.id)

    def recover_interrupted_deliveries(self, account_id: str) -> int:
        """Recover persisted ``sending`` rows without blindly replaying creates."""
        conflicts = 0
        inflight = self.storage.pending_mutations(
            account_id, delivery_state=OutboxDeliveryState.SENDING
        )
        for mutation in inflight:
            assert mutation.id is not None
            if self._non_idempotent_create(mutation):
                self._quarantine_uncertain_create(mutation, "process stopped while sending")
                conflicts += 1
            else:
                # Event creates carry a deterministic Google event ID. Updates,
                # deletes, moves and responses are repeatable against a remote ID.
                self.storage.reset_mutation_pending(
                    account_id, mutation.id, "recovering interrupted delivery"
                )
        return conflicts

    def flush_outbox(
        self, account_id: str, *, context: _RetryContext | None = None
    ) -> SyncResult:
        context = context or self._retry_context()
        pushed = 0
        conflicts = self.recover_interrupted_deliveries(account_id)
        for mutation in self.storage.pending_mutations(
            account_id, delivery_state=OutboxDeliveryState.PENDING
        ):
            assert mutation.id is not None
            request_id = mutation.request_id
            if (
                mutation.entity_type is EntityType.EVENT
                and mutation.operation is MutationOperation.CREATE
            ):
                request_id = request_id or self._event_request_id(mutation)
            self.storage.mark_mutation_sending(
                account_id,
                mutation.id,
                request_id=request_id,
                started_at=self.now(),
            )
            sending = self.storage.get_mutation(account_id, mutation.id)
            if sending is None:
                raise RuntimeError(f"outbox mutation {mutation.id} disappeared")
            self.crash_hook("before-request", sending)
            try:
                response = self._retry_call(
                    "Sending local change",
                    lambda sending=sending: self._push(sending),
                    context,
                    safe_to_retry=lambda error, sending=sending: isinstance(
                        error, RequestNotSentError
                    )
                    or not self._non_idempotent_create(sending),
                )
            except _RetryCancelled:
                self.storage.reset_mutation_pending(account_id, mutation.id, "sync cancelled")
                return SyncResult(
                    pushed=pushed,
                    conflicts=conflicts,
                    cancelled=True,
                    retry_message=(
                        "Sync cancelled. Local changes remain queued; run sync to resume."
                    ),
                )
            except _RetryExhausted as error:
                self.storage.fail_mutation(account_id, mutation.id, str(error.error))
                return SyncResult(
                    pushed=pushed,
                    conflicts=conflicts,
                    retry_pending=True,
                    retry_after=error.retry_after,
                    retry_exhausted=True,
                    retry_message=(
                        "Sync paused after bounded retries. Local changes remain queued; "
                        "run sync to resume."
                    ),
                )
            except TransientTransportError as exc:
                if self._non_idempotent_create(sending):
                    self._quarantine_uncertain_create(
                        sending, "transport ended before Google confirmed delivery"
                    )
                    conflicts += 1
                    continue
                self.storage.fail_mutation(account_id, mutation.id, str(exc))
                raise
            except GoogleApiError as exc:
                if (
                    sending.entity_type is EntityType.EVENT
                    and sending.operation is MutationOperation.CREATE
                    and sending.request_id is not None
                    and exc.status == 409
                ):
                    response = {"id": sending.request_id}
                elif self._non_idempotent_create(sending) and self._transient(exc):
                    self._quarantine_uncertain_create(
                        sending, f"Google returned ambiguous status {exc.status}"
                    )
                    conflicts += 1
                    continue
                elif exc.status in {401, 403} and exc.reason not in RATE_LIMIT_REASONS:
                    self.storage.fail_mutation(account_id, mutation.id, str(exc))
                    raise AuthenticationRequired(
                        "Google authorization is required", hint="Reconnect this account"
                    ) from exc
                elif exc.is_conflict:
                    with self.storage.transaction():
                        self.storage.add_conflict(
                            Conflict(
                                None,
                                account_id,
                                mutation.entity_type,
                                mutation.entity_id,
                                mutation.payload,
                                {"status": exc.status, "reason": exc.reason},
                            )
                        )
                        self.storage.complete_mutation(account_id, mutation.id)
                    conflicts += 1
                    continue
                else:
                    self.storage.fail_mutation(account_id, mutation.id, str(exc))
                    raise
            except KeyboardInterrupt:
                self.storage.reset_mutation_pending(account_id, mutation.id, "sync cancelled")
                raise
            self.crash_hook("after-remote-success", sending)
            with self.storage.transaction():
                self._accept_push(sending, response)
                self.storage.complete_mutation(account_id, mutation.id)
            pushed += 1
        return SyncResult(pushed=pushed, conflicts=conflicts)

    def _remote_list(self, account_id: str, value: str) -> str:
        item = self.storage.get_task_list(account_id, value)
        return item.remote_id if item and item.remote_id else value

    def _remote_calendar(self, account_id: str, value: str) -> str:
        item = self.storage.get_calendar(account_id, value)
        return item.remote_id if item and item.remote_id else value

    def _push(self, mutation: PendingMutation) -> Json | None:
        payload, account_id = mutation.payload, mutation.account_id
        body = _clean_body(payload)
        etag = payload.get("etag")
        if mutation.entity_type is EntityType.TASK_LIST:
            task_list = self.storage.get_task_list(account_id, mutation.entity_id)
            remote = task_list.remote_id if task_list else payload.get("remote_id")
            if mutation.operation is MutationOperation.CREATE:
                return self.gateway.create_task_list(body)
            if mutation.operation is MutationOperation.UPDATE:
                return self.gateway.update_task_list(
                    _required_remote(remote, "task list"), body, etag=etag
                )
            self.gateway.delete_task_list(_required_remote(remote, "task list"), etag=etag)
            return None
        if mutation.entity_type is EntityType.TASK:
            task = self.storage.get_task(account_id, mutation.entity_id)
            remote = task.remote_id if task else payload.get("remote_id")
            local_list_id = payload.get("list_id") or (task.list_id if task else None)
            list_id = self._remote_list(account_id, _required_remote(local_list_id, "task list"))
            if mutation.operation is MutationOperation.CREATE:
                return self.gateway.create_task(list_id, body)
            if mutation.operation is MutationOperation.UPDATE:
                return self.gateway.update_task(
                    list_id, _required_remote(remote, "task"), body, etag=etag
                )
            if mutation.operation is MutationOperation.MOVE:
                source_local = payload.get("source_list_id") or local_list_id
                source = self._remote_list(account_id, _required_remote(source_local, "task list"))
                destination = list_id if source_local != local_list_id else None
                parent_local = payload.get("parent")
                previous_local = payload.get("previous")
                parent_task = (
                    self.storage.get_task(account_id, parent_local)
                    if isinstance(parent_local, str)
                    else None
                )
                previous_task = (
                    self.storage.get_task(account_id, previous_local)
                    if isinstance(previous_local, str)
                    else None
                )
                parent = (
                    _required_remote(parent_task.remote_id if parent_task else None, "parent task")
                    if parent_local
                    else None
                )
                previous = (
                    _required_remote(
                        previous_task.remote_id if previous_task else None, "previous task"
                    )
                    if previous_local
                    else None
                )
                return self.gateway.move_task(
                    source,
                    _required_remote(remote, "task"),
                    destination_task_list_id=destination,
                    parent=parent,
                    previous=previous,
                )
            self.gateway.delete_task(list_id, _required_remote(remote, "task"), etag=etag)
            return None
        if mutation.entity_type is EntityType.CALENDAR:
            calendar = self.storage.get_calendar(account_id, mutation.entity_id)
            remote = calendar.remote_id if calendar else payload.get("remote_id")
            if mutation.operation is MutationOperation.CREATE:
                return self.gateway.create_calendar(body)
            if mutation.operation is MutationOperation.SUBSCRIBE:
                return self.gateway.subscribe_calendar(_required_remote(remote, "calendar"))
            if mutation.operation is MutationOperation.REMOVE:
                self.gateway.remove_calendar(_required_remote(remote, "calendar"))
                return None
            if mutation.operation is MutationOperation.UPDATE:
                if payload.get("resource") == "calendar-list":
                    return self.gateway.update_calendar_list(
                        _required_remote(remote, "calendar"), body, etag=etag
                    )
                return self.gateway.update_calendar(
                    _required_remote(remote, "calendar"), body, etag=etag
                )
            self.gateway.delete_calendar(_required_remote(remote, "calendar"), etag=etag)
            return None
        event = self.storage.get_event(account_id, mutation.entity_id)
        remote = event.remote_id if event else payload.get("remote_id")
        local_calendar_id = payload.get("calendar_id") or (event.calendar_id if event else None)
        calendar_id = self._remote_calendar(
            account_id, _required_remote(local_calendar_id, "calendar")
        )
        if mutation.operation is MutationOperation.CREATE:
            if mutation.request_id is None:
                raise ValueError("event create has no deterministic request id")
            body["id"] = mutation.request_id
            return self.gateway.create_event(
                calendar_id,
                body,
                send_updates=payload.get("send_updates", "none"),
                supports_attachments=bool(payload.get("supports_attachments", False)),
                conference_data_version=int(payload.get("conference_data_version", 0)),
            )
        if mutation.operation is MutationOperation.UPDATE:
            return self.gateway.update_event(
                calendar_id,
                _required_remote(payload.get("target_remote_id") or remote, "event"),
                body,
                etag=etag,
                send_updates=payload.get("send_updates", "none"),
                supports_attachments=bool(payload.get("supports_attachments", False)),
                conference_data_version=int(payload.get("conference_data_version", 0)),
            )
        if mutation.operation is MutationOperation.MOVE:
            destination = self._remote_calendar(account_id, payload["destination"])
            return self.gateway.move_event(
                calendar_id, _required_remote(remote, "event"), destination
            )
        if mutation.operation is MutationOperation.RESPOND:
            return self.gateway.respond_event(
                calendar_id,
                _required_remote(remote, "event"),
                payload["response_status"],
                etag=etag,
                comment=payload.get("comment"),
                send_updates=payload.get("send_updates", "all"),
            )
        self.gateway.delete_event(
            calendar_id,
            _required_remote(payload.get("target_remote_id") or remote, "event"),
            etag=etag,
            send_updates=payload.get("send_updates", "none"),
        )
        return None

    def _accept_push(self, mutation: PendingMutation, response: Json | None) -> None:
        if response is None:
            return
        account_id = mutation.account_id
        if mutation.entity_type is EntityType.TASK_LIST:
            current_list = self.storage.get_task_list(account_id, mutation.entity_id)
            if current_list:
                self.storage.upsert_task_list(
                    replace(
                        current_list,
                        remote_id=response.get("id", current_list.remote_id),
                        metadata=_metadata(response),
                    )
                )
        elif mutation.entity_type is EntityType.TASK:
            current_task = self.storage.get_task(account_id, mutation.entity_id)
            if current_task:
                self.storage.upsert_task(
                    replace(
                        current_task,
                        remote_id=response.get("id", current_task.remote_id),
                        metadata=_metadata(response),
                    )
                )
        elif mutation.entity_type is EntityType.CALENDAR:
            current_calendar = self.storage.get_calendar(account_id, mutation.entity_id)
            if current_calendar:
                self.storage.upsert_calendar(
                    replace(
                        current_calendar,
                        remote_id=response.get("id", current_calendar.remote_id),
                        metadata=_metadata(response),
                    )
                )
        else:
            current_event = self.storage.get_event(account_id, mutation.entity_id)
            if current_event:
                remote_id = (
                    mutation.request_id
                    if mutation.operation is MutationOperation.CREATE
                    else response.get("id", current_event.remote_id)
                )
                self.storage.upsert_event(
                    replace(
                        current_event,
                        remote_id=remote_id,
                        metadata=_metadata(response),
                    )
                )
