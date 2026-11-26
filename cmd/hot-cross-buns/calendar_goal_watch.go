package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
)

func hashCalendarWatch(ctx context.Context, runtime connector.Runtime, source jobs.WatchSource, now time.Time, zone string) ([]jobs.WatchItem, error) {
	if source.CalendarID == "" || source.Days < 1 || source.Days > 30 {
		return nil, errors.New("review an explicit Calendar and 1–30 day window first")
	}
	location := time.UTC
	if zone != "" {
		var err error
		location, err = time.LoadLocation(zone)
		if err != nil {
			return nil, err
		}
	}
	local := now.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	end := start.AddDate(0, 0, source.Days)
	cursor := ""
	seen := map[string]bool{}
	pages := map[string]bool{}
	items := []jobs.WatchItem{}
	for page := 0; page < 5; page++ {
		input, _ := json.Marshal(map[string]any{"calendar_id": source.CalendarID, "time_min": start.Format(time.RFC3339), "time_max": end.Format(time.RFC3339), "limit": 100, "cursor": cursor})
		result, err := runtime.Invoke(ctx, action.Inspect, source.ConnectorID, "calendar_events", input)
		if err != nil {
			return nil, fmt.Errorf("read watched Calendar: %w", err)
		}
		var listing struct {
			Items []json.RawMessage `json:"items"`
			Next  string            `json:"nextPageToken"`
			Error json.RawMessage   `json:"error"`
		}
		if json.Unmarshal(result.Data, &listing) != nil || listing.Error != nil || len(listing.Items) > 100 {
			return nil, errors.New("Calendar returned invalid or incomplete event coverage")
		}
		for _, raw := range listing.Items {
			var event map[string]any
			if json.Unmarshal(raw, &event) != nil {
				return nil, errors.New("invalid watched event")
			}
			id, _ := event["id"].(string)
			if !validWatchItemID(id) || seen[id] {
				return nil, errors.New("Calendar returned missing or duplicate event identities")
			}
			seen[id] = true
			// Provider links and retrieval metadata are not meaningful event changes.
			delete(event, "htmlLink")
			delete(event, "etag")
			digest, err := watchItemHash(event)
			if err != nil {
				return nil, err
			}
			items = append(items, jobs.WatchItem{Source: source.ConnectorID + "/calendar_events", ID: id, SHA256: digest})
		}
		if listing.Next == "" {
			sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
			return items, nil
		}
		if pages[listing.Next] || len(listing.Next) > 2048 {
			return nil, errors.New("Calendar pagination did not advance")
		}
		pages[listing.Next] = true
		cursor = listing.Next
	}
	return nil, errors.New("Calendar coverage exceeds 500 events; narrow the reviewed window")
}
