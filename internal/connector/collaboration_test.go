package connector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

func TestSlackThreadDiscoveryAndSearchPagination(t *testing.T) {
	seen := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen[r.URL.Path] = true
		switch r.URL.Path {
		case "/conversations.list":
			if r.URL.Query().Get("cursor") != "next" || r.URL.Query().Get("types") != "public_channel,private_channel" {
				t.Error("channel pagination/types missing")
			}
		case "/conversations.replies":
			if r.URL.Query().Get("channel") != "C123" || r.URL.Query().Get("ts") != "1482960137.003543" || r.URL.Query().Get("limit") != "15" || r.URL.Query().Get("cursor") != "next" {
				t.Error("thread parameters missing")
			}
		case "/search.messages":
			if r.URL.Query().Get("page") != "2" || r.URL.Query().Get("count") != "5" {
				t.Error("search pagination missing")
			}
		default:
			t.Error("unexpected request", r.URL)
		}
		fmt.Fprint(w, `{"ok":true,"response_metadata":{"next_cursor":"later"},"messages":[]}`)
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "slack", Name: "Slack", Kind: KindSlack, Resource: server.URL, Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
	for _, tc := range []struct{ op, input string }{
		{"channels_list", `{"query":"public_channel,private_channel","cursor":"next"}`},
		{"thread_replies", `{"resource_id":"C123","thread_ts":"1482960137.003543","cursor":"next"}`},
		{"search", `{"query":"decision","cursor":"2","limit":5}`},
	} {
		result, err := runtime.Invoke(context.Background(), action.Inspect, d.ID, tc.op, json.RawMessage(tc.input))
		if err != nil || !strings.Contains(string(result.Data), "later") {
			t.Fatalf("%s: %v", tc.op, err)
		}
	}
	if len(seen) != 3 {
		t.Fatal("missing Slack requests")
	}
	for _, input := range []string{`{"resource_id":"C123"}`, `{"resource_id":"../C123","thread_ts":"1482960137.003543"}`, `{"resource_id":"C123","thread_ts":"bad"}`} {
		if _, err := runtime.Invoke(context.Background(), action.Inspect, d.ID, "thread_replies", json.RawMessage(input)); err == nil {
			t.Fatal("invalid thread accepted", input)
		}
	}
}
func TestNotionContentAndDataSourceRuntime(t *testing.T) {
	const id = "d9824bdc-8445-4327-be8b-5b47500af6ce"
	writes, queries := 0, 0
	missing := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Notion-Version") != "2026-03-11" {
			t.Error("missing API version")
		}
		if r.Method == http.MethodGet {
			fmt.Fprintf(w, `{"id":%q}`, id)
			return
		}
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.HasSuffix(r.URL.Path, "/query") {
			queries++
			if r.Method != "POST" || string(body["page_size"]) != "5" || string(body["start_cursor"]) != `"next"` || len(body["filter"]) == 0 || len(body["sorts"]) == 0 {
				t.Error("data source query parameters missing")
			}
			fmt.Fprint(w, `{"object":"list","results":[],"has_more":false}`)
			return
		}
		writes++
		if r.Method != "PATCH" || len(body["resource_id"]) > 0 {
			t.Error("invalid Notion write")
		}
		if missing {
			fmt.Fprint(w, `{}`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/children") {
			fmt.Fprintf(w, `{"object":"list","results":[{"id":%q}]}`, id)
		} else {
			fmt.Fprintf(w, `{"id":%q}`, id)
		}
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "notion", Name: "Notion", Kind: KindNotion, Resource: server.URL, Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
	for _, op := range []string{"block_get", "database_get", "data_source_get"} {
		if _, err := runtime.Invoke(context.Background(), action.Inspect, d.ID, op, json.RawMessage(`{"resource_id":"`+id+`"}`)); err != nil {
			t.Fatal(err)
		}
	}
	_, err = runtime.Invoke(context.Background(), action.Inspect, d.ID, "data_source_query", json.RawMessage(`{"resource_id":"`+id+`","limit":5,"cursor":"next","payload":{"filter":{"property":"Status","select":{"equals":"Done"}},"sorts":[{"property":"Created","direction":"descending"}]}}`))
	if err != nil || queries != 1 || writes != 0 {
		t.Fatal("query was not read-only", err)
	}
	for _, tc := range []struct{ op, fields string }{
		{"block_update", `"paragraph":{"rich_text":[{"text":{"content":"Updated"}}]}`},
		{"block_append", `"children":[{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"text":{"content":"Note"}}]}}],"position":{"type":"end"}`},
	} {
		p, err := runtime.PrepareAction(d.ID, tc.op, json.RawMessage(`{"payload":{"resource_id":"`+id+`",`+tc.fields+`}}`))
		if err != nil {
			t.Fatal(err)
		}
		before := writes
		if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Inspect, p); err == nil || writes != before {
			t.Fatal("inspect mode changed Notion")
		}
		evidence, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p)
		if err != nil || evidence.ProviderResourceID != id || evidence.ResponseSHA256 == "" {
			t.Fatalf("%s: %+v %v", tc.op, evidence, err)
		}
		missing = true
		if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); err == nil {
			t.Fatal("missing receipt accepted")
		}
		missing = false
	}
	for _, tc := range []struct{ op, fields string }{
		{"block_append", `"children":[]`},
		{"block_append", `"children":[{}]`},
		{"block_append", `"children":[{"type":"paragraph"}],"url":"https://evil.test"`},
		{"block_append", `"children":[{"type":"paragraph"}],"position":{"type":"after_block","after_block":{"id":"../bad"}}`},
		{"block_update", ``},
	} {
		separator := ","
		if tc.fields == "" {
			separator = ""
		}
		if _, err := runtime.PrepareAction(d.ID, tc.op, json.RawMessage(`{"payload":{"resource_id":"`+id+`"`+separator+tc.fields+`}}`)); err == nil {
			t.Fatal("invalid action prepared", tc)
		}
	}
	if _, _, _, err := notionExtraRead(d, "block_get", serviceInput{ResourceID: "../secret"}); err == nil {
		t.Fatal("unsafe ID")
	}
	if _, _, _, err := notionExtraRead(d, "data_source_query", serviceInput{ResourceID: id, Payload: json.RawMessage(`{"url":"https://evil.test"}`)}); err == nil {
		t.Fatal("query allows arbitrary routing fields")
	}
}
