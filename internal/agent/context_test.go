package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

type contextProbe struct {
	requests []TurnRequest
	fail     bool
}

func (m *contextProbe) Complete(_ context.Context, r TurnRequest) (Turn, error) {
	m.requests = append(m.requests, r)
	if m.fail {
		return Turn{}, errors.New("summary offline")
	}
	return Turn{Text: "Retain the user's exact scope. Verification pending; no external action is approved."}, nil
}
func TestContextCountUsesTextEncodingAndIncludesEveryInputSurface(t *testing.T) {
	p := ContextPolicy{Window: 8192, OutputReserve: 1024, Encoding: "o200k_base"}
	text := strings.Repeat("A meeting about the garden. ", 100)
	if n := p.Count(text); n >= len(text) || n < 100 {
		t.Fatal("BPE was not used", n)
	}
	source := "树🌲 café " + strings.Repeat("重要的例外条件 ", 100)
	trimmed := p.Trim(source, 40)
	if !utf8.ValidString(trimmed) || p.Count(trimmed) > 40 || !strings.Contains(trimmed, "shortened") {
		t.Fatal("invalid bounded excerpt", trimmed, p.Count(trimmed))
	}
	base := p.RequestTokens(TurnRequest{})
	r := TurnRequest{System: "System instructions", Tools: []ToolDefinition{{Name: "read", Description: text, Parameters: json.RawMessage(`{"type":"object"}`)}}, Messages: []Message{{Role: RoleUser, Content: text, ProviderData: json.RawMessage(`{"opaque":"state"}`), Images: []Image{{Data: []byte("png")}}, Attachments: []Attachment{{Name: "notes", MediaType: "text/plain", Data: []byte(text)}}}}}
	if p.RequestTokens(r) <= base+4096+p.Count(text)*2 {
		t.Fatal("input surfaces were not included")
	}
}
func TestContextGuardChecksBeforeTransportAndReservesOutput(t *testing.T) {
	spy := &contextProbe{}
	p := ContextPolicy{Window: 2048, OutputReserve: 256}
	m := WithContextPolicy(spy, p)
	_, err := m.Complete(context.Background(), TurnRequest{System: strings.Repeat("system", 400), Messages: []Message{{Role: RoleUser, Content: "hello"}}})
	if err == nil || len(spy.requests) != 0 {
		t.Fatal("oversized request reached transport", err)
	}
	if _, err = m.Complete(context.Background(), TurnRequest{Messages: []Message{{Role: RoleUser, Content: "hello"}}}); err != nil {
		t.Fatal(err)
	}
	if spy.requests[0].MaxOutputTokens != 256 {
		t.Fatal("reply reserve was not transmitted")
	}
	if ContextFor(WithBudget(m, &Budget{})).Window != 2048 {
		t.Fatal("budget wrapper lost context metadata")
	}
}
func TestCompactionAdaptsToWindowAndPreservesCompleteToolInteractions(t *testing.T) {
	request := TurnRequest{System: "Keep scope and approvals unchanged.", Messages: []Message{{Role: RoleUser, Content: "Inspect project.md; do not send anything."}}}
	for i := 0; i < 12; i++ {
		id := fmt.Sprint("call-", i)
		request.Messages = append(request.Messages, Message{Role: RoleAgent, ToolCalls: []ToolCall{{ID: id, Name: "read", Arguments: json.RawMessage(`{}`)}}}, Message{Role: RoleTool, ToolCallID: id, Content: strings.Repeat("Reference evidence. ", 100)})
	}
	spy := &contextProbe{}
	large := WithContextPolicy(spy, ContextPolicy{Window: 65536, OutputReserve: 1024})
	unchanged, summary, err := CompactContext(context.Background(), large, request, "Inspect project.md; do not send anything.")
	if err != nil || summary != "" || len(unchanged.Messages) != len(request.Messages) || len(spy.requests) > 0 {
		t.Fatal("fitting large context was compacted", err)
	}
	small := WithContextPolicy(spy, ContextPolicy{Window: 8192, OutputReserve: 1024})
	prepared, summary, err := CompactContext(context.Background(), small, request, "Inspect project.md; do not send anything.")
	if err != nil || summary == "" || ContextFor(small).RequestTokens(prepared) > ContextFor(small).InputLimit() {
		t.Fatal("small context was not fitted", err)
	}
	pending := map[string]bool{}
	objective := false
	for _, message := range prepared.Messages {
		objective = objective || message.Content == request.Messages[0].Content
		for _, call := range message.ToolCalls {
			pending[call.ID] = true
		}
		if message.Role == RoleTool {
			if !pending[message.ToolCallID] {
				t.Fatal("orphaned tool result")
			}
			delete(pending, message.ToolCallID)
		}
	}
	if !objective || len(pending) > 0 || prepared.Messages[len(prepared.Messages)-1].ToolCallID != "call-11" {
		t.Fatal("current task or newest interaction was lost")
	}
	for _, call := range spy.requests {
		if ContextFor(small).RequestTokens(call) > ContextFor(small).InputLimit() {
			t.Fatal("summary request exceeded model input budget")
		}
	}
}
func TestFailedCompactionRetainsOriginalAndRefusesOversizedCurrentInput(t *testing.T) {
	spy := &contextProbe{fail: true}
	m := WithContextPolicy(spy, ContextPolicy{Window: 4096, OutputReserve: 512})
	request := TurnRequest{Messages: []Message{{Role: RoleUser, Content: strings.Repeat("older ", 700)}, {Role: RoleAgent, Content: "Old result"}, {Role: RoleUser, Content: "Current exact request"}}}
	before, _ := json.Marshal(request)
	got, _, err := CompactContext(context.Background(), m, request)
	after, _ := json.Marshal(got)
	if err == nil || string(before) != string(after) {
		t.Fatal("failure altered original context", err)
	}
	spy.requests = nil
	request.Messages = request.Messages[:1]
	if _, _, err = CompactContext(context.Background(), m, request); err == nil || len(spy.requests) > 0 {
		t.Fatal("oversized current input was summarized away", err)
	}
}
