import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CoreViewModelSource } from "../../coreViewModelSource";
import {
  calendarAvailabilityHoldDrafts,
  calendarAvailabilityRange,
  calendarAvailabilitySlotsInRange,
  calendarTimeBlockIsWithinAvailabilityRange,
  sortedCalendarTimeBlocks
} from "./calendarGrid";
import { calendarAddUtcDays, calendarCurrentDayKey } from "./calendarDateUtils";
import { defaultCalendarId } from "./drafts";
import type { CalendarTimeBlock } from "./types";

export function useCalendarAvailability(source: CoreViewModelSource): {
  addAvailabilitySlot: (slot: CalendarTimeBlock) => void;
  availabilityBusyBlockCount: number | null;
  availabilityCalendarId: string;
  availabilityDurationMinutes: number;
  availabilityEndDate: string;
  availabilityError: string | undefined;
  availabilityHoldPending: boolean;
  availabilityPending: boolean;
  availabilitySlots: CalendarTimeBlock[];
  availabilityStartDate: string;
  availabilityText: string;
  availabilityTitle: string;
  createAvailabilityHolds: () => Promise<void>;
  exportAvailability: () => Promise<void>;
  removeAvailabilitySlot: (slotId: string) => void;
  setAvailabilityCalendarId: Dispatch<SetStateAction<string>>;
  setAvailabilityDurationMinutes: Dispatch<SetStateAction<number>>;
  setAvailabilityEndDate: Dispatch<SetStateAction<string>>;
  setAvailabilityStartDate: Dispatch<SetStateAction<string>>;
  setAvailabilityTitle: (title: string) => void;
  setShareAvailabilityOpen: Dispatch<SetStateAction<boolean>>;
  shareAvailabilityOpen: boolean;
} {
  const [shareAvailabilityOpen, setShareAvailabilityOpen] = useState(false);
  // Title typing belongs to the small sidebar panel, not CalendarView. Keep
  // the latest draft here for the durable Create Holds action without making
  // each character invalidate the visible Calendar grid.
  const availabilityTitleRef = useRef("Meeting");
  const [availabilityDurationMinutes, setAvailabilityDurationMinutes] = useState(30);
  const [availabilityCalendarId, setAvailabilityCalendarId] = useState(() => defaultCalendarId(source));
  const [availabilitySlots, setAvailabilitySlots] = useState<CalendarTimeBlock[]>([]);
  const [availabilityHoldPending, setAvailabilityHoldPending] = useState(false);
  const [availabilityStartDate, setAvailabilityStartDate] = useState(() =>
    calendarCurrentDayKey(source.settings.defaultTimeZone)
  );
  const [availabilityEndDate, setAvailabilityEndDate] = useState(() =>
    calendarAddUtcDays(calendarCurrentDayKey(source.settings.defaultTimeZone), 6)
  );
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>([]);
  const [availabilityText, setAvailabilityText] = useState("");
  const [availabilityError, setAvailabilityError] = useState<string | undefined>();
  const [availabilityBusyBlockCount, setAvailabilityBusyBlockCount] = useState<number | null>(null);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const availableCalendarIds = useMemo(
    () => new Set(source.calendarSources.map((calendar) => calendar.id)),
    [source.calendarSources]
  );
  const selectedAvailabilityCalendarIds = availabilityCalendarIds.filter((calendarId) =>
    availableCalendarIds.has(calendarId)
  );
  const availabilityRange = useMemo(
    () => calendarAvailabilityRange(availabilityStartDate, availabilityEndDate, source.settings.defaultTimeZone),
    [availabilityEndDate, availabilityStartDate, source.settings.defaultTimeZone]
  );
  const visibleAvailabilitySlots = useMemo(
    () =>
      availabilityRange
        ? calendarAvailabilitySlotsInRange(availabilitySlots, availabilityRange)
        : availabilitySlots,
    [availabilityRange, availabilitySlots]
  );
  const canExportAvailability =
    selectedAvailabilityCalendarIds.length > 0 &&
    availabilityRange !== null &&
    Date.parse(availabilityRange.end) > Date.parse(availabilityRange.start) &&
    !availabilityPending;

  const setAvailabilityTitle = useCallback((title: string) => {
    availabilityTitleRef.current = title;
  }, []);

  useEffect(() => {
    if (availabilityCalendarIds.length > 0 || source.calendarSources.length === 0) {
      return;
    }

    const selectedCalendarIds = source.calendarSources
      .filter((calendar) => calendar.selected)
      .map((calendar) => calendar.id);

    setAvailabilityCalendarIds(
      selectedCalendarIds.length > 0
        ? selectedCalendarIds
        : source.calendarSources.map((calendar) => calendar.id)
    );
  }, [availabilityCalendarIds.length, source.calendarSources]);

  useEffect(() => {
    if (source.calendarSources.length === 0) {
      setAvailabilityCalendarId("");
      return;
    }

    if (availabilityCalendarId && source.calendarSources.some((calendar) => calendar.id === availabilityCalendarId)) {
      return;
    }

    setAvailabilityCalendarId(defaultCalendarId(source));
  }, [availabilityCalendarId, source, source.calendarSources]);

  useEffect(() => {
    if (!availabilityRange) {
      return;
    }

    setAvailabilitySlots((current) => {
      const next = calendarAvailabilitySlotsInRange(current, availabilityRange);
      return next.length === current.length ? current : next;
    });
    setAvailabilityText("");
    setAvailabilityBusyBlockCount(null);
  }, [availabilityRange]);

  async function exportAvailability(): Promise<void> {
    if (!canExportAvailability || availabilityRange === null) {
      setAvailabilityError("Choose at least one calendar and a valid date range.");
      return;
    }

    setAvailabilityPending(true);
    setAvailabilityError(undefined);

    const result = await window.hcb?.calendar.exportAvailability({
      calendarIds: selectedAvailabilityCalendarIds,
      start: availabilityRange.start,
      end: availabilityRange.end,
      format: "text"
    });

    setAvailabilityPending(false);

    if (!result?.ok) {
      setAvailabilityError(result?.error.message ?? "Availability export failed.");
      return;
    }

    setAvailabilityText(result.data.text);
    setAvailabilityBusyBlockCount(result.data.busyBlockCount);
  }

  function addAvailabilitySlot(slot: CalendarTimeBlock): void {
    if (!availabilityRange || !calendarTimeBlockIsWithinAvailabilityRange(slot, availabilityRange)) {
      setAvailabilityError("Selected time is outside the availability date range.");
      return;
    }

    setAvailabilityError(undefined);
    setAvailabilitySlots((current) => {
      if (current.some((candidate) => candidate.id === slot.id)) {
        return current;
      }

      return sortedCalendarTimeBlocks([...current, slot]);
    });
  }

  function removeAvailabilitySlot(slotId: string): void {
    setAvailabilitySlots((current) => current.filter((slot) => slot.id !== slotId));
  }

  async function createAvailabilityHolds(): Promise<void> {
    if (!availabilityRange) {
      setAvailabilityError("Choose a valid availability date range.");
      return;
    }

    if (visibleAvailabilitySlots.length === 0) {
      setAvailabilityError("Select at least one time block within the availability date range.");
      return;
    }

    if (!availabilityCalendarId) {
      setAvailabilityError("Choose a calendar.");
      return;
    }

    setAvailabilityHoldPending(true);
    setAvailabilityError(undefined);

    for (const draft of calendarAvailabilityHoldDrafts({
      calendarId: availabilityCalendarId,
      slots: visibleAvailabilitySlots,
      timeZone: source.settings.defaultTimeZone,
      title: availabilityTitleRef.current
    })) {
      const result = await window.hcb?.calendar.create(draft);

      if (!result?.ok) {
        setAvailabilityHoldPending(false);
        setAvailabilityError(result?.error.message ?? "Hold write failed.");
        return;
      }
    }

    setAvailabilityHoldPending(false);
    setAvailabilitySlots([]);
    source.refresh();
  }

  return {
    addAvailabilitySlot,
    availabilityBusyBlockCount,
    availabilityCalendarId,
    availabilityDurationMinutes,
    availabilityEndDate,
    availabilityError,
    availabilityHoldPending,
    availabilityPending,
    availabilitySlots: visibleAvailabilitySlots,
    availabilityStartDate,
    availabilityText,
    availabilityTitle: availabilityTitleRef.current,
    createAvailabilityHolds,
    exportAvailability,
    removeAvailabilitySlot,
    setAvailabilityCalendarId,
    setAvailabilityDurationMinutes,
    setAvailabilityEndDate,
    setAvailabilityStartDate,
    setAvailabilityTitle,
    setShareAvailabilityOpen,
    shareAvailabilityOpen
  };
}
