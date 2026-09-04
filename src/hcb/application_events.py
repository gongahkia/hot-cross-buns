"""Optimistic calendar-event workflows."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from .application import (
    BatchActionPreview,
    BatchMovePreview,
    ResponseStatus,
    _dirty,
    _id,
    _Unset,
)
from .application_calendars import CalendarServiceMixin
from .models import (
    EntityType,
    Event,
    EventDateTime,
    EventStatus,
    Metadata,
    MutationOperation,
    PendingMutation,
    ReminderOverride,
)
from .task_recurrence import _matches_rule, _parse_rule

_UNSET = _Unset()


class EventServiceMixin(CalendarServiceMixin):
    def create_event(
        self,
        account_id: str,
        calendar_id: str,
        summary: str,
        start: EventDateTime,
        end: EventDateTime,
        *,
        description: str | None = None,
        location: str | None = None,
        recurrence: tuple[str, ...] = (),
        reminder_use_default: bool = True,
        reminder_overrides: tuple[ReminderOverride, ...] = (),
        attendees: tuple[dict[str, Any], ...] = (),
        event_type: str | None = None,
        transparency: str | None = None,
        visibility: str | None = None,
        color_id: str | None = None,
        attachments: tuple[dict[str, Any], ...] = (),
        conference: dict[str, Any] | None = None,
        guests_can_invite_others: bool | None = None,
        guests_can_modify: bool | None = None,
        guests_can_see_other_guests: bool | None = None,
        anyone_can_add_self: bool | None = None,
        focus_time_properties: dict[str, Any] | None = None,
        out_of_office_properties: dict[str, Any] | None = None,
        working_location_properties: dict[str, Any] | None = None,
        send_updates: str = "none",
        supports_attachments: bool = False,
        conference_data_version: int = 0,
        id: str | None = None,
    ) -> Event:
        self._require_calendar(account_id, calendar_id)
        if not summary.strip():
            raise ValueError("event summary is required")
        self._validate_event_times(start, end)
        self._validate_event_options(send_updates, supports_attachments, conference_data_version)
        event = Event(
            id or _id(),
            account_id,
            calendar_id,
            summary.strip(),
            start,
            end,
            description=description,
            location=location,
            recurrence=recurrence,
            metadata=_dirty(Metadata()),
            reminder_use_default=reminder_use_default,
            reminder_overrides=reminder_overrides,
            attendees=attendees,
            event_type=event_type,
            transparency=transparency,
            visibility=visibility,
            color_id=color_id,
            attachments=attachments,
            conference=conference,
            guests_can_invite_others=guests_can_invite_others,
            guests_can_modify=guests_can_modify,
            guests_can_see_other_guests=guests_can_see_other_guests,
            anyone_can_add_self=anyone_can_add_self,
            focus_time_properties=focus_time_properties,
            out_of_office_properties=out_of_office_properties,
            working_location_properties=working_location_properties,
        )
        with self.storage.transaction():
            self.storage.upsert_event(event)
            if event.recurrence:
                self.storage.mark_instance_ranges_stale(
                    account_id, calendar_id, reason="local-recurring-event-created"
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event.id,
                MutationOperation.CREATE,
                {
                    "calendar_id": calendar_id,
                    "body": self._event_body(event),
                    "send_updates": send_updates,
                    "supports_attachments": supports_attachments,
                    "conference_data_version": conference_data_version,
                },
            )
            self._intent(
                account_id,
                "create",
                EntityType.EVENT,
                event.id,
                None,
                self._snapshot("events", account_id, event.id),
            )
        return event

    def update_event(
        self,
        account_id: str,
        event_id: str,
        *,
        summary: str | None = None,
        start: EventDateTime | None = None,
        end: EventDateTime | None = None,
        description: str | None | _Unset = _UNSET,
        location: str | None | _Unset = _UNSET,
        status: EventStatus | str | None = None,
        recurrence: tuple[str, ...] | _Unset = _UNSET,
        attendees: tuple[dict[str, Any], ...] | _Unset = _UNSET,
        reminder_use_default: bool | _Unset = _UNSET,
        reminder_overrides: tuple[ReminderOverride, ...] | _Unset = _UNSET,
        event_type: str | None | _Unset = _UNSET,
        transparency: str | None | _Unset = _UNSET,
        visibility: str | None | _Unset = _UNSET,
        color_id: str | None | _Unset = _UNSET,
        attachments: tuple[dict[str, Any], ...] | _Unset = _UNSET,
        conference: dict[str, Any] | None | _Unset = _UNSET,
        guests_can_invite_others: bool | None | _Unset = _UNSET,
        guests_can_modify: bool | None | _Unset = _UNSET,
        guests_can_see_other_guests: bool | None | _Unset = _UNSET,
        anyone_can_add_self: bool | None | _Unset = _UNSET,
        focus_time_properties: dict[str, Any] | None | _Unset = _UNSET,
        out_of_office_properties: dict[str, Any] | None | _Unset = _UNSET,
        working_location_properties: dict[str, Any] | None | _Unset = _UNSET,
        send_updates: str = "none",
        supports_attachments: bool = False,
        conference_data_version: int = 0,
        scope: Literal["this", "series"] = "this",
    ) -> Event:
        current = self._require_event(account_id, event_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        if scope not in {"this", "series"}:
            raise ValueError("event scope must be this or series")
        if scope == "series" and current.is_occurrence:
            if not current.canonical_id:
                raise ValueError("event occurrence has no canonical recurring series")
            series = self.storage.get_event_by_remote(account_id, current.canonical_id)
            if series is None:
                raise ValueError("the canonical recurring series is not cached")
            current = series
            event_id = series.id
        self._validate_event_options(send_updates, supports_attachments, conference_data_version)
        if summary is not None and not summary.strip():
            raise ValueError("event summary is required")
        next_start, next_end = start or current.start, end or current.end
        self._validate_event_times(next_start, next_end)
        updated = replace(
            current,
            summary=summary.strip() if summary is not None else current.summary,
            start=next_start,
            end=next_end,
            description=current.description if isinstance(description, _Unset) else description,
            location=current.location if isinstance(location, _Unset) else location,
            status=EventStatus(status) if status is not None else current.status,
            recurrence=current.recurrence if isinstance(recurrence, _Unset) else recurrence,
            attendees=current.attendees if isinstance(attendees, _Unset) else attendees,
            reminder_use_default=(
                current.reminder_use_default
                if isinstance(reminder_use_default, _Unset)
                else reminder_use_default
            ),
            reminder_overrides=(
                current.reminder_overrides
                if isinstance(reminder_overrides, _Unset)
                else reminder_overrides
            ),
            event_type=current.event_type if isinstance(event_type, _Unset) else event_type,
            transparency=current.transparency if isinstance(transparency, _Unset) else transparency,
            visibility=current.visibility if isinstance(visibility, _Unset) else visibility,
            color_id=current.color_id if isinstance(color_id, _Unset) else color_id,
            attachments=current.attachments if isinstance(attachments, _Unset) else attachments,
            conference=current.conference if isinstance(conference, _Unset) else conference,
            guests_can_invite_others=(
                current.guests_can_invite_others
                if isinstance(guests_can_invite_others, _Unset)
                else guests_can_invite_others
            ),
            guests_can_modify=(
                current.guests_can_modify
                if isinstance(guests_can_modify, _Unset)
                else guests_can_modify
            ),
            guests_can_see_other_guests=(
                current.guests_can_see_other_guests
                if isinstance(guests_can_see_other_guests, _Unset)
                else guests_can_see_other_guests
            ),
            anyone_can_add_self=(
                current.anyone_can_add_self
                if isinstance(anyone_can_add_self, _Unset)
                else anyone_can_add_self
            ),
            focus_time_properties=(
                current.focus_time_properties
                if isinstance(focus_time_properties, _Unset)
                else focus_time_properties
            ),
            out_of_office_properties=(
                current.out_of_office_properties
                if isinstance(out_of_office_properties, _Unset)
                else out_of_office_properties
            ),
            working_location_properties=(
                current.working_location_properties
                if isinstance(working_location_properties, _Unset)
                else working_location_properties
            ),
            metadata=_dirty(current.metadata),
        )
        affects_instance_cache = affects_instance_cache or bool(updated.recurrence)
        body = self._event_body(updated)
        for key, value, changed in (
            ("description", updated.description, not isinstance(description, _Unset)),
            ("location", updated.location, not isinstance(location, _Unset)),
            ("recurrence", list(updated.recurrence), not isinstance(recurrence, _Unset)),
            ("attendees", list(updated.attendees), not isinstance(attendees, _Unset)),
            ("eventType", updated.event_type, not isinstance(event_type, _Unset)),
            ("transparency", updated.transparency, not isinstance(transparency, _Unset)),
            ("visibility", updated.visibility, not isinstance(visibility, _Unset)),
            ("colorId", updated.color_id, not isinstance(color_id, _Unset)),
            ("attachments", list(updated.attachments), not isinstance(attachments, _Unset)),
            ("conferenceData", updated.conference, not isinstance(conference, _Unset)),
            (
                "guestsCanInviteOthers",
                updated.guests_can_invite_others,
                not isinstance(guests_can_invite_others, _Unset),
            ),
            (
                "guestsCanModify",
                updated.guests_can_modify,
                not isinstance(guests_can_modify, _Unset),
            ),
            (
                "guestsCanSeeOtherGuests",
                updated.guests_can_see_other_guests,
                not isinstance(guests_can_see_other_guests, _Unset),
            ),
            (
                "anyoneCanAddSelf",
                updated.anyone_can_add_self,
                not isinstance(anyone_can_add_self, _Unset),
            ),
            (
                "focusTimeProperties",
                updated.focus_time_properties,
                not isinstance(focus_time_properties, _Unset),
            ),
            (
                "outOfOfficeProperties",
                updated.out_of_office_properties,
                not isinstance(out_of_office_properties, _Unset),
            ),
            (
                "workingLocationProperties",
                updated.working_location_properties,
                not isinstance(working_location_properties, _Unset),
            ),
        ):
            if changed:
                body[key] = value
        if not isinstance(reminder_use_default, _Unset) or not isinstance(
            reminder_overrides, _Unset
        ):
            body["reminders"] = {
                "useDefault": updated.reminder_use_default,
                "overrides": [
                    {"method": item.method, "minutes": item.minutes}
                    for item in updated.reminder_overrides
                ],
            }
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(updated)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-updated"
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.UPDATE,
                {
                    "calendar_id": current.calendar_id,
                    "body": body,
                    "etag": current.metadata.etag,
                    "remote_id": current.remote_id,
                    "target_remote_id": (
                        current.canonical_id
                        if scope == "series" and current.is_occurrence
                        else current.remote_id
                    ),
                    "send_updates": send_updates,
                    "supports_attachments": supports_attachments,
                    "conference_data_version": conference_data_version,
                },
            )
            self._intent(
                account_id,
                "update",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return updated

    def move_event(self, account_id: str, event_id: str, calendar_id: str) -> Event:
        current = self._require_event(account_id, event_id)
        self._require_calendar(account_id, calendar_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        updated = replace(current, calendar_id=calendar_id, metadata=_dirty(current.metadata))
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(updated)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-moved"
                )
                if calendar_id != current.calendar_id:
                    self.storage.mark_instance_ranges_stale(
                        account_id, calendar_id, reason="local-recurring-event-moved"
                    )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.MOVE,
                {
                    "calendar_id": current.calendar_id,
                    "destination": calendar_id,
                    "remote_id": current.remote_id,
                },
            )
            self._intent(
                account_id,
                "move",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return updated

    def duplicate_event(
        self,
        account_id: str,
        event_id: str,
        *,
        calendar_id: str | None = None,
        summary: str | None = None,
        start: EventDateTime | None = None,
        end: EventDateTime | None = None,
        include_recurrence: bool = False,
        include_attendees: bool = False,
        send_updates: str = "none",
    ) -> Event:
        """Create an independent copy; invitations and recurrence are opt-in."""
        source = self._require_event(account_id, event_id)
        target_calendar = calendar_id or source.calendar_id
        return self.create_event(
            account_id,
            target_calendar,
            summary or source.summary,
            start or source.start,
            end or source.end,
            description=source.description,
            location=source.location,
            recurrence=source.recurrence if include_recurrence else (),
            reminder_use_default=source.reminder_use_default,
            reminder_overrides=source.reminder_overrides,
            attendees=source.attendees if include_attendees else (),
            event_type=source.event_type,
            transparency=source.transparency,
            visibility=source.visibility,
            color_id=source.color_id,
            attachments=source.attachments,
            guests_can_invite_others=source.guests_can_invite_others,
            guests_can_modify=source.guests_can_modify,
            guests_can_see_other_guests=source.guests_can_see_other_guests,
            anyone_can_add_self=source.anyone_can_add_self,
            focus_time_properties=source.focus_time_properties,
            out_of_office_properties=source.out_of_office_properties,
            working_location_properties=source.working_location_properties,
            send_updates=send_updates,
            supports_attachments=bool(source.attachments),
        )

    def respond_event(
        self,
        account_id: str,
        event_id: str,
        response_status: ResponseStatus,
        *,
        comment: str | None = None,
        send_updates: str = "all",
    ) -> PendingMutation:
        current = self._require_event(account_id, event_id)
        if response_status not in {"accepted", "declined", "tentative", "needsAction"}:
            raise ValueError("invalid RSVP response")
        payload = {
            "calendar_id": current.calendar_id,
            "response_status": response_status,
            "remote_id": current.remote_id,
            "etag": current.metadata.etag,
            "comment": comment,
            "send_updates": send_updates,
        }
        with self.storage.transaction():
            mutation_id = self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.RESPOND,
                payload,
            )
        return replace(
            PendingMutation(
                mutation_id,
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.RESPOND,
                payload,
            )
        )

    def respond_events(
        self,
        account_id: str,
        event_ids: list[str],
        response_status: ResponseStatus,
        *,
        comment: str | None = None,
        send_updates: str = "all",
    ) -> tuple[PendingMutation, ...]:
        preview = self.preview_event_response(account_id, event_ids, response_status)
        with self.storage.transaction():
            return tuple(
                self.respond_event(
                    account_id,
                    event.id,
                    response_status,
                    comment=comment,
                    send_updates=send_updates,
                )
                for event in preview.items
                if isinstance(event, Event)
            )

    def delete_events(self, account_id: str, event_ids: list[str]) -> tuple[Event, ...]:
        preview = self.preview_event_deletion(account_id, event_ids)
        with self.storage.transaction():
            return tuple(
                self.delete_event(account_id, event.id)
                for event in preview.items
                if isinstance(event, Event)
            )

    def _batch_events(self, account_id: str, event_ids: list[str]) -> tuple[Event, ...]:
        ids = tuple(dict.fromkeys(event_ids))
        if not ids:
            raise ValueError("select at least one event")
        return tuple(self._require_event(account_id, event_id) for event_id in ids)

    def preview_event_response(
        self, account_id: str, event_ids: list[str], response_status: ResponseStatus
    ) -> BatchActionPreview:
        if response_status not in {"accepted", "declined", "tentative", "needsAction"}:
            raise ValueError("invalid RSVP response")
        return BatchActionPreview(
            "event",
            "respond",
            self._batch_events(account_id, event_ids),
            response_status=response_status,
        )

    def preview_event_deletion(self, account_id: str, event_ids: list[str]) -> BatchActionPreview:
        return BatchActionPreview("event", "delete", self._batch_events(account_id, event_ids))

    def preview_event_move(
        self, account_id: str, event_ids: list[str], calendar_id: str
    ) -> BatchMovePreview:
        """Validate that every selected event supports a native calendar move."""
        destination = self._require_calendar(account_id, calendar_id)
        targets = self._batch_events(account_id, event_ids)
        unsupported = [
            event.summary for event in targets if event.event_type not in {None, "default"}
        ]
        if unsupported:
            raise ValueError(
                "Google only moves default events between calendars; unsupported: "
                + ", ".join(unsupported)
            )
        return BatchMovePreview("event", destination.id, targets)

    def move_events(
        self, account_id: str, event_ids: list[str], calendar_id: str
    ) -> tuple[Event, ...]:
        preview = self.preview_event_move(account_id, event_ids, calendar_id)
        with self.storage.transaction():
            return tuple(
                self.move_event(account_id, event.id, preview.destination_id)
                for event in preview.items
                if isinstance(event, Event)
            )

    def delete_event(
        self,
        account_id: str,
        event_id: str,
        *,
        scope: Literal["this", "series"] = "this",
        send_updates: str = "none",
    ) -> Event:
        current = self._require_event(account_id, event_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        if scope not in {"this", "series"}:
            raise ValueError("event scope must be this or series")
        series_remote_id: str | None = None
        if scope == "series" and current.is_occurrence:
            if not current.canonical_id:
                raise ValueError("event occurrence has no canonical recurring series")
            series = self.storage.get_event_by_remote(account_id, current.canonical_id)
            if series is None:
                raise ValueError("the canonical recurring series is not cached")
            series_remote_id = current.canonical_id
            current = series
            event_id = series.id
        self._validate_event_options(send_updates, False, 0)
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(deleted)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-deleted"
                )
            if series_remote_id:
                self.storage.hide_cached_series_instances(
                    account_id, current.calendar_id, series_remote_id
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.DELETE,
                {
                    "calendar_id": current.calendar_id,
                    "remote_id": current.remote_id,
                    "target_remote_id": (
                        current.canonical_id
                        if scope == "series" and current.is_occurrence
                        else current.remote_id
                    ),
                    "etag": current.metadata.etag,
                    "send_updates": send_updates,
                },
            )
            self._intent(
                account_id,
                "delete",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return deleted

    def split_recurring_event(
        self, account_id: str, event_id: str, *, send_updates: str = "none"
    ) -> tuple[Event, Event]:
        occurrence = self._require_event(account_id, event_id)
        if not occurrence.is_occurrence or not occurrence.canonical_id:
            raise ValueError("split requires a synchronized recurring event instance")
        series = self.storage.get_event_by_remote(account_id, occurrence.canonical_id)
        if series is None or not series.recurrence:
            raise ValueError("the canonical recurring series is not cached")
        rule = next((line for line in series.recurrence if line.startswith("RRULE:")), None)
        if rule is None:
            raise ValueError("the recurring series has no supported RRULE")
        split_value = occurrence.start.value
        if isinstance(split_value, datetime):
            cutoff = (split_value.astimezone(UTC) - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
        else:
            cutoff = (split_value - timedelta(days=1)).strftime("%Y%m%d")
        prefix, _separator, body = rule.partition(":")
        clauses = body.split(";")
        count = next(
            (int(value) for part in clauses if (key, _eq, value) := part.partition("=") if key == "COUNT"),
            None,
        )
        unbounded = [part for part in clauses if not part.startswith(("UNTIL=", "COUNT="))]
        old_rule = f"{prefix}:{';'.join((*unbounded, f'UNTIL={cutoff}'))}"
        new_clauses = list(unbounded)
        if count is not None:
            preceding = self._recurrence_occurrences_through(series, split_value, unbounded)
            remaining = count - preceding + 1
            if preceding < 1 or remaining < 1:
                raise ValueError("the selected occurrence is outside the recurring series")
            new_clauses.append(f"COUNT={remaining}")
        new_rule = f"{prefix}:{';'.join(new_clauses)}"
        with self.storage.transaction():
            old = self.update_event(
                account_id,
                series.id,
                recurrence=tuple(old_rule if line == rule else line for line in series.recurrence),
                send_updates=send_updates,
                scope="series",
            )
            new = self.create_event(
                account_id,
                occurrence.calendar_id,
                occurrence.summary,
                occurrence.start,
                occurrence.end,
                description=occurrence.description,
                location=occurrence.location,
                recurrence=tuple(new_rule if line == rule else line for line in series.recurrence),
                attendees=occurrence.attendees,
                reminder_use_default=occurrence.reminder_use_default,
                reminder_overrides=occurrence.reminder_overrides,
                send_updates=send_updates,
            )
        return old, new

    @staticmethod
    def _recurrence_occurrences_through(
        series: Event, split_value: date | datetime, clauses: list[str]
    ) -> int:
        """Count supported RRULE occurrences up to an instance selected for a split.

        The same bounded date-only matcher powers HCB task recurrence.  It
        covers the RRULE subset exposed by the event editor (daily/weekly/
        monthly/yearly, interval and BY* controls) without requiring a second
        recurrence dependency merely to split a finite series.
        """
        anchor_value = series.start.value
        anchor = anchor_value.date() if isinstance(anchor_value, datetime) else anchor_value
        target = split_value.date() if isinstance(split_value, datetime) else split_value
        raw_rule = ";".join(part for part in clauses if not part.startswith("WKST="))
        parsed = _parse_rule(raw_rule)
        if parsed is None:
            raise ValueError("this COUNT recurrence uses unsupported split rules")
        occurrences = 0
        current = anchor
        while current <= target:
            if _matches_rule(current, anchor, parsed):
                occurrences += 1
            current += timedelta(days=1)
        return occurrences
