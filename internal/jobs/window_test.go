package jobs

import (
	"testing"
	"time"
)

func TestScheduleWindowControlsDuePreviewAndCatchup(t *testing.T) {
	parse := func(s string) time.Time { at, _ := time.Parse(time.RFC3339, s); return at }
	d := Definition{Enabled: true, Schedule: "0 20 * * *", Timezone: "Asia/Singapore", Missed: "run_once", CreatedAt: parse("2026-11-26T00:00:00+08:00"), StartsAt: parse("2026-11-30T00:00:00+08:00"), EndsAt: parse("2026-12-07T00:00:00+08:00")}
	preview, err := d.Upcoming(d.CreatedAt, 10)
	if err != nil || len(preview) != 7 || !preview[0].Equal(parse("2026-11-30T20:00:00+08:00")) || !preview[6].Equal(parse("2026-12-06T20:00:00+08:00")) {
		t.Fatal("window preview", preview, err)
	}
	for _, at := range []time.Time{parse("2026-11-26T20:00:00+08:00"), d.StartsAt.Add(-time.Minute), d.EndsAt, d.EndsAt.Add(time.Hour)} {
		if _, due, err := Due(d, at); err != nil || due {
			t.Fatal("ran outside the window", at, err)
		}
	}
	at, due, err := Due(d, parse("2026-12-03T09:00:00+08:00"))
	if err != nil || !due || !at.Equal(parse("2026-12-02T20:00:00+08:00")) {
		t.Fatal("catch-up must select the latest eligible slot", at, due, err)
	}
	d.StartsAt = parse("2026-11-30T20:00:00+08:00")
	at, due, err = Due(d, d.StartsAt)
	if err != nil || !due || !at.Equal(d.StartsAt) {
		t.Fatal("start must be inclusive", at, due, err)
	}
}

func TestScheduleWindowTracksDaylightSavingAndPolicy(t *testing.T) {
	start, _ := time.Parse(time.RFC3339, "2026-10-31T00:00:00-04:00")
	d := Definition{Schedule: "0 9 * * *", Timezone: "America/New_York", StartsAt: start, EndsAt: start.Add(72 * time.Hour)}
	before, _ := d.PolicyDigest()
	occurrences, err := d.Upcoming(start, 3)
	if err != nil || len(occurrences) != 3 || occurrences[1].Sub(occurrences[0]) != 25*time.Hour {
		t.Fatal("local clock must survive DST", occurrences, err)
	}
	d.StartsAt = start.Add(time.Hour)
	after, _ := d.PolicyDigest()
	if before == after {
		t.Fatal("window changed without invalidating authority")
	}
}
