package connector

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

func calendarRuntime(t *testing.T, handler http.HandlerFunc) (Runtime, *int) {
	t.Helper()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; handler(w, r) }))
	t.Cleanup(server.Close)
	d := Descriptor{Version: 1, ID: "google", Name: "Google", Kind: KindGoogle, Resource: server.URL, Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	return Runtime{Registry: registry, HTTPClient: server.Client()}, &calls
}
func TestCalendarOAuthSurfaceRequiresSeparateScopes(t *testing.T) {
	d := Descriptor{Kind: KindGoogle, Authentication: AuthOAuth, OAuthScopes: GoogleDailyOAuthScopes}
	names := func() map[string]bool {
		result := map[string]bool{}
		for _, op := range d.Operations() {
			result[op.ID] = true
			if strings.HasPrefix(op.ID, "calendar_event_") && op.ID != "calendar_event_get" && !action.RequiresFreshApproval(op.Capability) {
				t.Fatal("calendar write lost exact review", op)
			}
		}
		return result
	}
	if names()["calendar_events"] {
		t.Fatal("email login silently gained calendar access")
	}
	d.OAuthScopes += " " + GoogleCalendarReadScope
	if !names()["calendar_events"] || !names()["calendar_freebusy"] || !names()["calendar_list"] || names()["calendar_event_create"] {
		t.Fatal("read-only calendar surface incorrect")
	}
	d.OAuthScopes += " " + GoogleCalendarWriteScope
	if !names()["calendar_event_create"] || !names()["calendar_event_update"] || !names()["calendar_event_delete"] {
		t.Fatal("reviewed event mutations missing")
	}
}
func TestCalendarReadsUseExactTargetsRangesAndPagination(t *testing.T) {
	for _, test := range []struct{ op, input, method, path string }{
		{"calendar_list", `{"cursor":"next page","limit":3}`, "GET", "/calendar/v3/users/me/calendarList"},
		{"calendar_events", `{"calendar_id":"owner@example.test","time_min":"2030-05-16T00:00:00+08:00","time_max":"2030-05-17T00:00:00+08:00","cursor":"next page","limit":3}`, "GET", "/calendar/v3/calendars/owner@example.test/events"},
		{"calendar_event_get", `{"calendar_id":"primary","event_id":"event_20300516"}`, "GET", "/calendar/v3/calendars/primary/events/event_20300516"},
		{"calendar_freebusy", `{"calendar_ids":["primary"],"time_min":"2030-05-16T00:00:00Z","time_max":"2030-05-17T00:00:00Z"}`, "POST", "/calendar/v3/freeBusy"},
	} {
		t.Run(test.op, func(t *testing.T) {
			runtime, calls := calendarRuntime(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != test.method || r.URL.Path != test.path {
					t.Errorf("wrong request: %s %s", r.Method, r.URL)
				}
				if test.op == "calendar_events" && (r.URL.Query().Get("singleEvents") != "true" || r.URL.Query().Get("pageToken") != "next page" || r.URL.Query().Get("timeMin") != "2030-05-16T00:00:00+08:00") {
					t.Error("query bounds lost", r.URL)
				}
				if test.op == "calendar_freebusy" {
					data, _ := io.ReadAll(r.Body)
					if !strings.Contains(string(data), `"id":"primary"`) {
						t.Error("availability target lost", string(data))
					}
				}
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"nextPageToken":"remaining","items":[],"calendars":{"primary":{"errors":[{"reason":"notFound"}]}}}`)
			})
			result, err := runtime.Invoke(context.Background(), action.Inspect, "google", test.op, []byte(test.input))
			if err != nil || *calls != 1 || !strings.Contains(string(result.Data), "remaining") || !strings.Contains(string(result.Data), "notFound") {
				t.Fatal("read coverage/errors discarded", result, err)
			}
		})
	}
}
func TestCalendarMutationsPinReviewPayloadMethodETagAndReceipt(t *testing.T) {
	for _, test := range []struct {
		op, payload, method string
		status              int
		response            string
	}{
		{"calendar_event_create", `{"calendar_id":"primary","send_updates":"all","summary":"Workshop","start":{"dateTime":"2030-05-16T10:00:00+08:00","timeZone":"Asia/Singapore"},"end":{"dateTime":"2030-05-16T11:00:00+08:00","timeZone":"Asia/Singapore"},"attendees":[{"email":"mira@example.test"}]}`, "POST", 200, `{"id":"event-1"}`},
		{"calendar_event_update", `{"calendar_id":"primary","event_id":"event-1","etag":"\"revision-1\"","send_updates":"none","summary":"Corrected workshop"}`, "PATCH", 200, `{"id":"event-1"}`},
		{"calendar_event_delete", `{"calendar_id":"primary","event_id":"event-1","etag":"\"revision-1\"","send_updates":"all"}`, "DELETE", 204, ""},
	} {
		t.Run(test.op, func(t *testing.T) {
			runtime, calls := calendarRuntime(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != test.method || !strings.HasPrefix(r.URL.Path, "/calendar/v3/calendars/primary/events") {
					t.Errorf("wrong mutation %s %s", r.Method, r.URL)
				}
				if test.op != "calendar_event_create" && r.Header.Get("If-Match") != `"revision-1"` {
					t.Error("lost exact ETag", r.Header)
				}
				data, _ := io.ReadAll(r.Body)
				for _, private := range []string{"calendar_id", "send_updates", "event_id", "etag"} {
					if strings.Contains(string(data), private) {
						t.Error("host fields reached Google", string(data))
					}
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				io.WriteString(w, test.response)
			})
			prepared, err := runtime.PrepareAction("google", test.op, actionInput([]byte(test.payload)))
			if err != nil || *calls != 0 {
				t.Fatal("prepare caused external mutation", err, *calls)
			}
			if !strings.Contains(prepared.Proposal.Preview, "send_updates") || !strings.Contains(prepared.Proposal.Preview, "primary") {
				t.Fatal("review omitted target or notifications")
			}
			receipt, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared)
			if err != nil || *calls != 1 || receipt.ProviderResourceID != "event-1" {
				t.Fatal(receipt, err, *calls)
			}
		})
	}
}
func TestCalendarRejectsAmbiguousTargetsTimesAndStaleEventWrites(t *testing.T) {
	runtime, calls := calendarRuntime(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(412) })
	for _, raw := range []string{
		`{"calendar_id":"../private","event_id":"event-1","etag":"\"v1\"","send_updates":"none","summary":"Edit"}`,
		`{"calendar_id":"primary","event_id":"event-1","send_updates":"none","summary":"Edit"}`,
		`{"calendar_id":"primary","event_id":"event-1","etag":"*","send_updates":"none","summary":"Edit"}`,
		`{"calendar_id":"primary","event_id":"event-1","etag":"\"v1\"","send_updates":"none","start":{"dateTime":"2030-05-16T10:00:00"},"end":{"dateTime":"2030-05-16T11:00:00"}}`,
		`{"calendar_id":"primary","event_id":"event-1","etag":"\"v1\"","send_updates":"none","start":{"date":"2030-05-16"}}`,
	} {
		if _, err := runtime.PrepareAction("google", "calendar_event_update", actionInput([]byte(raw))); err == nil {
			t.Fatal("invalid calendar mutation accepted", raw)
		}
	}
	if *calls != 0 {
		t.Fatal("validation made network requests")
	}
	prepared, err := runtime.PrepareAction("google", "calendar_event_update", actionInput([]byte(`{"calendar_id":"primary","event_id":"event-1","etag":"\"v1\"","send_updates":"none","summary":"Edit"}`)))
	if err != nil {
		t.Fatal(err)
	}
	_, err = runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared)
	var status HTTPStatusError
	if err == nil || !errors.As(err, &status) || status.StatusCode != 412 || *calls != 1 {
		t.Fatal("stale write was not rejected", err, *calls)
	}
}
func TestCalendarTimeWindowAndAllDayBounds(t *testing.T) {
	d := Descriptor{Kind: KindGoogle, Resource: "https://www.googleapis.com"}
	for _, input := range []serviceInput{{CalendarID: "primary"}, {CalendarID: "primary", TimeMin: "2030-01-01T00:00:00Z", TimeMax: "2031-01-01T00:00:00Z"}, {CalendarID: "primary", TimeMin: "2030-05-17T00:00:00Z", TimeMax: "2030-05-16T00:00:00Z"}} {
		if _, _, _, err := calendarRead(d, "calendar_events", input); err == nil {
			t.Fatal("unbounded calendar read accepted")
		}
	}
	value := []byte(`{"calendar_id":"primary","send_updates":"none","summary":"Holiday","start":{"date":"2030-05-16"},"end":{"date":"2030-05-17"}}`)
	if _, err := decodeCalendarWrite("calendar_event_create", value, true); err != nil {
		t.Fatal("valid exclusive all-day range rejected", err)
	}
	var payload map[string]any
	_ = json.Unmarshal(value, &payload)
	payload["end"] = map[string]string{"date": "2030-05-16"}
	value, _ = json.Marshal(payload)
	if _, err := decodeCalendarWrite("calendar_event_create", value, true); err == nil {
		t.Fatal("empty all-day event accepted")
	}
}
