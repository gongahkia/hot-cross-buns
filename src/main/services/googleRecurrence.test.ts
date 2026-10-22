import { describe, expect, it } from "vitest";
import { expandGoogleRecurrenceLines, shiftGoogleRecurrenceSchedule, splitGoogleRecurrenceLines, withGoogleExdate } from "./googleRecurrence";

describe("splitGoogleRecurrenceLines", () => {
  it("partitions RDATE and EXDATE values and reduces RRULE/EXRULE COUNT exactly", () => {
    const result = splitGoogleRecurrenceLines({
      allDay: false,
      lines: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXRULE:FREQ=DAILY;COUNT=4",
        "RDATE;TZID=Asia/Singapore:20260301T090000,20260306T090000",
        "EXDATE;TZID=Asia/Singapore:20260302T090000,20260305T090000"
      ],
      seriesStartsAt: "2026-03-01T01:00:00.000Z",
      splitAt: "2026-03-03T01:00:00.000Z",
      timeZone: "Asia/Singapore"
    });

    expect(result.parentLines).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20260303T005959Z",
      "EXRULE:FREQ=DAILY;COUNT=4",
      "RDATE;TZID=Asia/Singapore:20260301T090000",
      "EXDATE;TZID=Asia/Singapore:20260302T090000"
    ]);
    expect(result.successorLines).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
      "EXRULE:FREQ=DAILY;COUNT=2",
      "RDATE;TZID=Asia/Singapore:20260306T090000",
      "EXDATE;TZID=Asia/Singapore:20260305T090000"
    ]);
  });

  it("uses calendar-wall time for COUNT across a daylight-saving boundary", () => {
    const result = splitGoogleRecurrenceLines({
      allDay: false,
      lines: ["RRULE:FREQ=DAILY;COUNT=5"],
      // 9am New York before and after the 2026 spring-forward transition.
      seriesStartsAt: "2026-03-07T14:00:00.000Z",
      splitAt: "2026-03-09T13:00:00.000Z",
      timeZone: "America/New_York"
    });

    expect(result.parentLines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20260309T125959Z"]);
    expect(result.successorLines).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  it("partitions all-day date values without turning them into timestamps", () => {
    const result = splitGoogleRecurrenceLines({
      allDay: true,
      lines: [
        "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
        "RDATE;VALUE=DATE:20260302,20260316",
        "EXDATE;VALUE=DATE:20260309,20260323"
      ],
      seriesStartsAt: "2026-03-02T00:00:00.000Z",
      splitAt: "2026-03-16T00:00:00.000Z",
      timeZone: "America/New_York"
    });

    expect(result.parentLines).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260315",
      "RDATE;VALUE=DATE:20260302",
      "EXDATE;VALUE=DATE:20260309"
    ]);
    expect(result.successorLines).toEqual([
      "RRULE:FREQ=WEEKLY;COUNT=2;BYDAY=MO",
      "RDATE;VALUE=DATE:20260316",
      "EXDATE;VALUE=DATE:20260323"
    ]);
  });

  it("does not extend an already-ended RRULE while bounding the parent", () => {
    const result = splitGoogleRecurrenceLines({
      allDay: false,
      lines: ["RRULE:FREQ=DAILY;UNTIL=20260302T010000Z"],
      seriesStartsAt: "2026-03-01T01:00:00.000Z",
      splitAt: "2026-03-04T01:00:00.000Z",
      timeZone: "Asia/Singapore"
    });

    expect(result.parentLines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20260302T010000Z"]);
    expect(result.successorLines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20260302T010000Z"]);
  });

  it("expands exact rule, inclusion, and exclusion lines into zoned virtual occurrences", () => {
    const occurrences = expandGoogleRecurrenceLines({
      allDay: false,
      startsAt: "2026-03-01T01:00:00.000Z",
      endsAt: "2026-03-01T02:00:00.000Z",
      rangeStart: "2026-03-01T00:00:00.000Z",
      rangeEnd: "2026-03-08T00:00:00.000Z",
      timeZone: "Asia/Singapore",
      lines: [
        "RRULE:FREQ=DAILY;COUNT=3",
        "RDATE;TZID=Asia/Singapore:20260306T090000",
        "EXDATE;TZID=Asia/Singapore:20260302T090000"
      ]
    });

    expect(occurrences.map((occurrence) => occurrence.startsAt)).toEqual([
      "2026-03-01T01:00:00.000Z",
      "2026-03-03T01:00:00.000Z",
      "2026-03-06T01:00:00.000Z"
    ]);
  });

  it("cancels a generated occurrence with a native EXDATE in the series timezone", () => {
    expect(withGoogleExdate(
      ["RRULE:FREQ=WEEKLY;COUNT=4"],
      "2026-03-08T13:00:00.000Z",
      false,
      "America/New_York"
    )).toEqual([
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "EXDATE;TZID=America/New_York:20260308T090000"
    ]);
    expect(withGoogleExdate(
      ["RRULE:FREQ=DAILY"],
      "2026-03-08T00:00:00.000Z",
      true,
      "America/New_York"
    )).toContain("EXDATE;VALUE=DATE:20260308");
  });
});

describe("recurrence schedule gestures", () => {
  it("moves explicit weekly weekdays and the UNTIL boundary", () => {
    expect(shiftGoogleRecurrenceSchedule(["RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270202T090000Z"], "2027-01-12T09:00:00Z", "2027-01-13T09:00:00Z", false, "UTC"))
      .toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20270203T090000Z"]);
  });
  it("moves explicit exclusions across DST in the series timezone", () => {
    expect(shiftGoogleRecurrenceSchedule(["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=3", "EXDATE:20270320T130000Z"], "2027-03-13T14:00:00Z", "2027-03-14T13:00:00Z", false, "America/New_York"))
      .toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3", "EXDATE:20270321T130000Z"]);
  });
  it("keeps all-day exclusions date-only", () => {
    expect(shiftGoogleRecurrenceSchedule(["RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE;VALUE=DATE:20270119"], "2027-01-12T00:00:00Z", "2027-01-13T00:00:00Z", true, "Asia/Singapore"))
      .toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;VALUE=DATE:20270120"]);
  });
  it("requires review for complex selectors instead of accepting a misleading date shift", () => {
    expect(() => shiftGoogleRecurrenceSchedule(["RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2"], "2027-01-12T09:00:00Z", "2027-01-13T09:00:00Z", false, "UTC")).toThrow("needs review");
  });
});
