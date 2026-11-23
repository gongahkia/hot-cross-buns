package workactivity

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

func TestOnlyAllowlistedDisplayIconsReachPublicActivity(t *testing.T) {
	for _, fixture := range []struct{ arguments, icon string }{
		{`{"display_icon":"book-open","private":"secret argument"}`, "book-open"},
		{`{"display_icon":"<svg onload=bad>","private":"secret argument"}`, ""},
		{`{"display_icon":{"private":"secret argument"}}`, ""},
	} {
		trace := New(time.Now())
		trace.Record(agent.Event{Kind: agent.EventToolCalled, ToolCall: &agent.ToolCall{ID: "read", Name: "read_file", Arguments: json.RawMessage(fixture.arguments)}})
		if len(trace.Entries) != 1 || trace.Entries[0].Icon != fixture.icon || trace.Entries[0].State != "running" {
			t.Fatalf("invalid icon projection: %#v", trace.Entries)
		}
		raw, _ := json.Marshal(trace)
		if strings.Contains(string(raw), "secret argument") || strings.Contains(string(raw), "onload") {
			t.Fatalf("non-display data leaked: %s", raw)
		}
	}
}

func TestOrderedPublicActivityPairsToolsAndSeparatesAnswer(t *testing.T) {
	start := time.Unix(100, 0).UTC()
	trace := New(start)
	call := &agent.ToolCall{ID: "read", Name: "read_file", Arguments: json.RawMessage(`{"secret":"private-argument"}`)}
	events := []agent.Event{
		{Kind: agent.EventTextDelta, Text: "I’ll check "}, {Kind: agent.EventTextDelta, Text: "the notes."},
		{Kind: agent.EventToolCalled, ToolCall: call},
		{Kind: agent.EventText, TaskID: "child", Text: "private-child-text"},
		{Kind: agent.EventToolFinished, ToolCall: call, ToolResult: "private-result", ToolError: "private-error"},
		{Kind: agent.EventTurnStarted, Step: 2}, {Kind: agent.EventTextDelta, Text: "Here is the answer."},
	}
	for i, event := range events {
		event.At = start.Add(time.Duration(i+1) * time.Second)
		trace.Record(event)
	}
	snapshot := trace.Clone()
	trace.Finish(start.Add(10*time.Second), "completed", "Here is the answer.")
	if len(trace.Entries) != 2 || trace.Entries[0].Text != "I’ll check the notes." || trace.Entries[1].State != "failed" {
		t.Fatalf("unexpected activity: %#v", trace)
	}
	if trace.Entries[1].StartedAt != start.Add(3*time.Second) || *trace.Entries[1].FinishedAt != start.Add(5*time.Second) {
		t.Fatal("tool timing or position changed at completion")
	}
	if snapshot.Entries[2].State != "running" {
		t.Fatal("snapshot aliased live entries")
	}
	raw, _ := json.Marshal(trace)
	for _, private := range []string{"private-argument", "private-result", "private-error", "private-child-text"} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("display leaked %q", private)
		}
	}
	if strings.Contains(string(raw), "Here is the answer") {
		t.Fatal("final answer was duplicated in activity")
	}
}

func TestActivityBoundedAndInterruptedWithoutFalseSuccess(t *testing.T) {
	now := time.Now()
	trace := New(now)
	trace.Record(agent.Event{Kind: agent.EventTextDelta, Text: strings.Repeat("海", maxTextBytes), At: now})
	trace.Record(agent.Event{Kind: agent.EventToolCalled, ToolCall: &agent.ToolCall{ID: "pending", Name: "search"}, At: now})
	for range maxEntries + 20 {
		trace.Record(agent.Event{Kind: agent.EventContextCompacted, At: now})
	}
	trace.Finish(now.Add(time.Second), "stopped", "")
	if !trace.Truncated || len(trace.Entries) != maxEntries || len(trace.Entries[0].Text) > maxTextBytes || !utf8.ValidString(trace.Entries[0].Text) {
		t.Fatal("activity bounds failed")
	}
	if trace.Entries[1].State != "stopped" || trace.State != "stopped" {
		t.Fatal("interrupted tool reported success")
	}
}

func TestCodingCommandFailureIsVisibleWithoutLeakingCommandData(t *testing.T) {
	trace := New(time.Now())
	call := &agent.ToolCall{ID: "test", Name: "code_run_command", Arguments: json.RawMessage(`{"secret":"hidden-input"}`)}
	trace.Record(agent.Event{Kind: agent.EventToolCalled, ToolCall: call})
	trace.Record(agent.Event{Kind: agent.EventToolFinished, ToolCall: call, ToolResult: `{"ok":true,"result":{"exit_code":1,"output":"private-error-output","argv":["private-argv"]}}`})
	if trace.Entries[0].State != "failed" {
		t.Fatal("failed program was displayed as a successful check")
	}
	payload, _ := json.Marshal(trace)
	for _, secret := range []string{"hidden-input", "private-error-output", "private-argv"} {
		if strings.Contains(string(payload), secret) {
			t.Fatalf("activity leaked %s", secret)
		}
	}
}

func TestPublicActivityRetainsOnlyHostOwnedBrandIdentity(t *testing.T) {
	trace := New(time.Now())
	call := &agent.ToolCall{ID: "slack-call", Name: "connector_notes_read", Arguments: json.RawMessage(`{"brand":"codex","token":"private-secret"}`)}
	trace.Record(agent.Event{Kind: agent.EventToolCalled, Brand: "slack", ToolCall: call})
	trace.Record(agent.Event{Kind: agent.EventToolFinished, Brand: "slack", ToolCall: call})
	if trace.Entries[0].Brand != "slack" || !trace.ValidDetails() {
		t.Fatal("brand not retained")
	}
	raw, _ := json.Marshal(trace.Clone())
	if strings.Contains(string(raw), "private-secret") || strings.Contains(string(raw), "codex") {
		t.Fatal("tool arguments leaked")
	}
	var restored Trace
	if err := json.Unmarshal(raw, &restored); err != nil || restored.Entries[0].Brand != "slack" || !restored.ValidDetails() {
		t.Fatal("brand lost during replay")
	}
	restored.Entries[0].Brand = "../../secret.png"
	if restored.ValidDetails() {
		t.Fatal("untrusted brand accepted in retained activity")
	}
	trace = New(time.Now())
	trace.Record(agent.Event{Kind: agent.EventToolCalled, Brand: "https://example.com/logo.png", ToolCall: call})
	if trace.Entries[0].Brand != "" {
		t.Fatal("unbounded brand projected")
	}
}
