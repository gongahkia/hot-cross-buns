package connector

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

const GoogleCalendarReadScope = "https://www.googleapis.com/auth/calendar.readonly"
const GoogleCalendarWriteScope = "https://www.googleapis.com/auth/calendar.events"

func calendarOperations() []Operation {
	specs := []serviceOperation{
		{"calendar_list", "List the calendars available to this selected Google account; follow nextPageToken for additional pages.", action.ConnectedRead},
		{"calendar_events", "Read events in an explicit calendar and time range of at most 90 days. Recurring instances are expanded; pagination and per-calendar errors must not be presented as complete coverage.", action.ConnectedRead},
		{"calendar_event_get", "Read one exact calendar event including its current ETag before proposing changes.", action.ConnectedRead},
		{"calendar_freebusy", "Read availability for up to 20 exact calendars within 90 days. Per-calendar errors do not mean availability.", action.ConnectedRead},
		{"calendar_event_create", "Create one calendar event after exact approval. Supply calendar_id, summary, start/end and explicit send_updates (all or none). Never retry an uncertain create automatically.", action.ConnectedMutate},
		{"calendar_event_update", "Patch one exact event after approval using its previously read ETag. Supply changed fields only; rescheduling requires both start and end. Attendees replace the entire list, so retain any existing attendees that should remain. A stale ETag requires a new read and review.", action.ConnectedMutate},
		{"calendar_event_delete", "Delete one exact event after fresh approval using its previously read ETag and explicit send_updates. Deleting a recurring series event affects the series; select an instance ID when only that occurrence should change.", action.ConnectedMutate},
	}
	ops := serviceOperations(specs)
	for i := range ops {
		switch ops[i].ID {
		case "calendar_list":
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"cursor":{"type":"string","maxLength":2048},"limit":{"type":"integer","minimum":1,"maximum":100}}}`)
		case "calendar_events":
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["calendar_id","time_min","time_max"],"properties":{"calendar_id":{"type":"string","maxLength":1024},"time_min":{"type":"string"},"time_max":{"type":"string"},"query":{"type":"string","maxLength":4096},"cursor":{"type":"string","maxLength":2048},"limit":{"type":"integer","minimum":1,"maximum":100}}}`)
		case "calendar_event_get":
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["calendar_id","event_id"],"properties":{"calendar_id":{"type":"string","maxLength":1024},"event_id":{"type":"string","maxLength":1024}}}`)
		case "calendar_freebusy":
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["calendar_ids","time_min","time_max"],"properties":{"calendar_ids":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"string","maxLength":1024}},"time_min":{"type":"string"},"time_max":{"type":"string"}}}`)
		default:
			required := []string{"calendar_id", "send_updates"}
			if ops[i].ID != "calendar_event_create" {
				required = append(required, "event_id", "etag")
			} else {
				required = append(required, "summary", "start", "end")
			}
			properties := map[string]any{"calendar_id": map[string]any{"type": "string", "maxLength": 1024}, "event_id": map[string]any{"type": "string", "maxLength": 1024}, "etag": map[string]any{"type": "string", "description": "Exact ETag returned by calendar_event_get; required for updates and deletion."}, "send_updates": map[string]any{"type": "string", "enum": []string{"all", "none"}}}
			if ops[i].ID != "calendar_event_delete" {
				for _, name := range []string{"summary", "description", "location"} {
					properties[name] = map[string]any{"type": "string", "maxLength": 8192}
				}
				point := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"date": map[string]any{"type": "string", "description": "YYYY-MM-DD; all-day end is exclusive"}, "dateTime": map[string]any{"type": "string", "description": "RFC3339 with an explicit offset"}, "timeZone": map[string]any{"type": "string", "description": "IANA time zone"}}}
				properties["start"], properties["end"] = point, point
				properties["attendees"] = map[string]any{"type": "array", "maxItems": 50, "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"email"}, "properties": map[string]any{"email": map[string]any{"type": "string", "maxLength": 320}}}}
			}
			ops[i].InputSchema, _ = json.Marshal(map[string]any{"type": "object", "additionalProperties": false, "required": []string{"payload"}, "properties": map[string]any{"payload": map[string]any{"type": "object", "additionalProperties": false, "required": required, "properties": properties}}})
		}
	}
	return ops
}

func calendarScopeAllows(operation string, scopes map[string]bool) bool {
	if !strings.HasPrefix(operation, "calendar_") {
		return true
	}
	full := scopes["https://www.googleapis.com/auth/calendar"]
	read := full || scopes[GoogleCalendarReadScope]
	events := read || scopes[GoogleCalendarWriteScope] || scopes["https://www.googleapis.com/auth/calendar.events.readonly"]
	switch operation {
	case "calendar_list":
		return read || scopes["https://www.googleapis.com/auth/calendar.calendarlist.readonly"]
	case "calendar_events", "calendar_event_get":
		return events
	case "calendar_freebusy":
		return read || scopes["https://www.googleapis.com/auth/calendar.freebusy"] || scopes["https://www.googleapis.com/auth/calendar.events.freebusy"]
	default:
		return full || scopes[GoogleCalendarWriteScope]
	}
}

func validCalendarID(id string) bool {
	for _, letter := range id {
		if unicode.IsControl(letter) || unicode.IsSpace(letter) {
			return false
		}
	}
	return id != "" && len(id) <= 1024 && id == strings.TrimSpace(id) && id != "." && id != ".." && !strings.ContainsAny(id, "/\\?#\x00\r\n\t ")
}
func calendarRange(min, max string) error {
	start, err := time.Parse(time.RFC3339, min)
	if err != nil {
		return errors.New("calendar time_min needs an RFC3339 timestamp with offset")
	}
	end, err := time.Parse(time.RFC3339, max)
	if err != nil || !end.After(start) || end.Sub(start) > 90*24*time.Hour {
		return errors.New("calendar time_max must follow time_min by no more than 90 days")
	}
	return nil
}
func calendarRead(d Descriptor, operation string, input serviceInput) (string, string, []byte, error) {
	query := url.Values{}
	method := http.MethodGet
	path := ""
	var body []byte
	limit := input.Limit
	if limit == 0 {
		limit = 25
	}
	switch operation {
	case "calendar_list":
		path = "/calendar/v3/users/me/calendarList"
		query.Set("maxResults", fmt.Sprint(limit))
	case "calendar_events", "calendar_event_get":
		if !validCalendarID(input.CalendarID) {
			return "", "", nil, errors.New("choose an exact calendar_id (or primary)")
		}
		path = "/calendar/v3/calendars/" + url.PathEscape(input.CalendarID) + "/events"
		if operation == "calendar_event_get" {
			if !validCalendarID(input.EventID) {
				return "", "", nil, errors.New("choose an exact event_id")
			}
			path += "/" + url.PathEscape(input.EventID)
		} else {
			if err := calendarRange(input.TimeMin, input.TimeMax); err != nil {
				return "", "", nil, err
			}
			query.Set("timeMin", input.TimeMin)
			query.Set("timeMax", input.TimeMax)
			query.Set("maxResults", fmt.Sprint(limit))
			query.Set("singleEvents", "true")
			query.Set("orderBy", "startTime")
			if input.Query != "" {
				query.Set("q", input.Query)
			}
		}
	case "calendar_freebusy":
		if err := calendarRange(input.TimeMin, input.TimeMax); err != nil {
			return "", "", nil, err
		}
		if len(input.CalendarIDs) < 1 || len(input.CalendarIDs) > 20 {
			return "", "", nil, errors.New("free/busy needs 1–20 exact calendar_ids")
		}
		items := []map[string]string{}
		seen := map[string]bool{}
		for _, id := range input.CalendarIDs {
			if !validCalendarID(id) || seen[id] {
				return "", "", nil, errors.New("free/busy calendar_ids must be valid and unique")
			}
			seen[id] = true
			items = append(items, map[string]string{"id": id})
		}
		body, _ = json.Marshal(map[string]any{"timeMin": input.TimeMin, "timeMax": input.TimeMax, "items": items, "calendarExpansionMax": 20, "groupExpansionMax": 0})
		path = "/calendar/v3/freeBusy"
		method = http.MethodPost
	default:
		return "", "", nil, errors.New("unknown calendar read")
	}
	if input.Cursor != "" {
		if operation != "calendar_list" && operation != "calendar_events" {
			return "", "", nil, errors.New("this calendar read does not paginate")
		}
		query.Set("pageToken", input.Cursor)
	}
	target := serviceBase(d, operation) + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	return target, method, body, nil
}

type calendarPoint struct {
	Date     string `json:"date,omitempty"`
	DateTime string `json:"dateTime,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}
type calendarWrite struct {
	CalendarID  string         `json:"calendar_id"`
	EventID     string         `json:"event_id,omitempty"`
	ETag        string         `json:"etag,omitempty"`
	SendUpdates string         `json:"send_updates"`
	Summary     *string        `json:"summary,omitempty"`
	Description *string        `json:"description,omitempty"`
	Location    *string        `json:"location,omitempty"`
	Start       *calendarPoint `json:"start,omitempty"`
	End         *calendarPoint `json:"end,omitempty"`
	Attendees   *[]struct {
		Email string `json:"email"`
	} `json:"attendees,omitempty"`
}

func decodeCalendarWrite(operation string, payload []byte, requireETag bool) (calendarWrite, error) {
	var value calendarWrite
	if !json.Valid(payload) {
		return value, errors.New("calendar payload must be one JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, fmt.Errorf("invalid calendar event payload: %w", err)
	}
	if !validCalendarID(value.CalendarID) || value.SendUpdates != "all" && value.SendUpdates != "none" {
		return value, errors.New("calendar writes require exact calendar_id and explicit send_updates all or none")
	}
	if value.ETag != "" && (len(value.ETag) < 2 || len(value.ETag) > 1024 || value.ETag[0] != '"' || value.ETag[len(value.ETag)-1] != '"' || strings.ContainsAny(value.ETag[1:len(value.ETag)-1], "\"\x00\r\n")) {
		return value, errors.New("calendar ETag must be one exact quoted value returned by the event read")
	}
	create := operation == "calendar_event_create"
	if !create && (!validCalendarID(value.EventID) || requireETag && (value.ETag == "" || value.ETag == "*")) {
		return value, errors.New("read the exact event and supply event_id and its current ETag before changing it")
	}
	if create && (value.EventID != "" || value.ETag != "") {
		return value, errors.New("event creation cannot include event_id or ETag")
	}
	if operation == "calendar_event_delete" {
		if value.Summary != nil || value.Description != nil || value.Location != nil || value.Start != nil || value.End != nil || value.Attendees != nil {
			return value, errors.New("event deletion cannot include edit fields")
		}
		return value, nil
	}
	if create && (value.Summary == nil || strings.TrimSpace(*value.Summary) == "" || value.Start == nil || value.End == nil) {
		return value, errors.New("new events require summary, start and end")
	}
	if value.Summary == nil && value.Description == nil && value.Location == nil && value.Start == nil && value.End == nil && value.Attendees == nil {
		return value, errors.New("event update has no changed fields")
	}
	for _, text := range []*string{value.Summary, value.Description, value.Location} {
		if text != nil && (len(*text) > 8192 || strings.ContainsRune(*text, 0)) {
			return value, errors.New("calendar text exceeds 8192 bytes or contains NUL")
		}
	}
	if value.Start != nil || value.End != nil {
		if value.Start == nil || value.End == nil {
			return value, errors.New("rescheduling requires both start and end")
		}
		start, allDay, err := calendarTime(*value.Start)
		if err != nil {
			return value, err
		}
		end, endAllDay, err := calendarTime(*value.End)
		if err != nil || allDay != endAllDay || !end.After(start) {
			return value, errors.New("event end must follow start using the same timed/all-day format")
		}
	}
	if value.Attendees != nil {
		if len(*value.Attendees) > 50 {
			return value, errors.New("use at most 50 attendees")
		}
		seen := map[string]bool{}
		for _, person := range *value.Attendees {
			parsed, err := mail.ParseAddress(person.Email)
			if err != nil || parsed.Address != person.Email || len(person.Email) > 320 || seen[strings.ToLower(person.Email)] {
				return value, errors.New("attendees need unique exact email addresses")
			}
			seen[strings.ToLower(person.Email)] = true
		}
	}
	return value, nil
}
func calendarTime(point calendarPoint) (time.Time, bool, error) {
	if point.TimeZone != "" {
		if _, err := time.LoadLocation(point.TimeZone); err != nil {
			return time.Time{}, false, errors.New("event timeZone must be a valid IANA zone")
		}
	}
	if point.Date != "" && point.DateTime == "" && point.TimeZone == "" {
		value, err := time.Parse("2006-01-02", point.Date)
		return value, true, err
	}
	if point.Date == "" && point.DateTime != "" {
		value, err := time.Parse(time.RFC3339, point.DateTime)
		return value, false, err
	}
	return time.Time{}, false, errors.New("event times need either date or dateTime with an explicit offset")
}
func calendarAction(d Descriptor, operation string, payload []byte) (string, []byte, error) {
	value, err := decodeCalendarWrite(operation, payload, false)
	if err != nil {
		return "", nil, err
	}
	path := "/calendar/v3/calendars/" + url.PathEscape(value.CalendarID) + "/events"
	if operation != "calendar_event_create" {
		path += "/" + url.PathEscape(value.EventID)
	}
	target := serviceBase(d, operation) + path + "?sendUpdates=" + value.SendUpdates
	if operation == "calendar_event_delete" {
		return target, nil, nil
	}
	var body map[string]json.RawMessage
	_ = json.Unmarshal(payload, &body)
	for _, key := range []string{"calendar_id", "event_id", "send_updates", "etag"} {
		delete(body, key)
	}
	encoded, err := json.Marshal(body)
	return target, encoded, err
}
