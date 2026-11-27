package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPolicyBlocksBeforeEffectsAndFailsClosedOnApproval(t *testing.T) {
	for _, action := range []PolicyAction{PolicyBlock, PolicyApproval, "unknown"} {
		tool := &recordingTool{}
		model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}}}
		result, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", Policies: []PolicyRule{{ID: "host", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
			if v.Stage == PolicyToolInput {
				return PolicyDecision{Action: action}, nil
			}
			return PolicyDecision{Action: PolicyAllow}, nil
		}}}})
		if !errors.Is(err, ErrPolicy) || result.Completion.Status != "blocked" || len(tool.arguments) > 0 {
			t.Fatal(action, result, err)
		}
	}
}
func TestPolicyRedactsBeforeReplayEventsAndAfterHook(t *testing.T) {
	tool := &recordingTool{result: ToolResult{Content: "secret"}}
	model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}, {Text: "done"}}}
	var events []Event
	result, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", OnEvent: func(e Event) { events = append(events, e) }, AfterTool: func(_ context.Context, _ ToolCall, r ToolResult, _ error) error {
		if r.Content != "[redacted]" {
			t.Fatal(r)
		}
		return nil
	}, Policies: []PolicyRule{{ID: "privacy", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyToolOutput {
			return PolicyDecision{Action: PolicyRedact, Replacement: "[redacted]"}, nil
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result.Messages)
	if strings.Contains(string(raw), "secret") {
		t.Fatal(string(raw))
	}
	for _, e := range events {
		if strings.Contains(e.ToolResult, "secret") {
			t.Fatal(e)
		}
	}
}
func TestPolicyVerificationIsBoundedAndApprovalCannotBypassDomainGate(t *testing.T) {
	model := &scriptedModel{turns: []Turn{{Text: "premature"}, {Text: "verified"}}}
	checks := 0
	result, err := (Runner{Model: model}).Run(context.Background(), RunOptions{Task: "work", Policies: []PolicyRule{{ID: "proof", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyFinal {
			checks++
			if checks == 1 {
				return PolicyDecision{Action: PolicyVerify, Reason: "inspect proof"}, nil
			}
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil || result.Steps != 2 || result.FinalText != "verified" {
		t.Fatal(result, err)
	}
	tool := &recordingTool{}
	model = &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}, {Text: "blocked by domain"}}}
	_, err = (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", ApprovePolicy: func(context.Context, string, PolicyInputValue, string) (bool, error) { return true, nil }, BeforeTool: func(context.Context, ToolCall) error { return errors.New("domain denied") }, Policies: []PolicyRule{{ID: "approval", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyToolInput {
			return PolicyDecision{Action: PolicyApproval}, nil
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil || len(tool.arguments) > 0 {
		t.Fatal(err, tool.arguments)
	}
}

func TestPolicyWithholdsStreamingOutputUntilValidation(t *testing.T) {
	var text string
	result, err := (Runner{Model: streamingModel{turn: Turn{Text: "private"}, deltas: []string{"pri", "vate"}}}).Run(context.Background(), RunOptions{Task: "work", OnEvent: func(e Event) {
		if e.Kind == EventText || e.Kind == EventTextDelta {
			text += e.Text
		}
	}, Policies: []PolicyRule{{ID: "privacy", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyModelOutput {
			return PolicyDecision{Action: PolicyRedact, Replacement: "safe"}, nil
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil || text != "safe" || result.FinalText != "safe" {
		t.Fatal(result, err, text)
	}
}

func TestPolicyRedactionClearsOpaqueProviderReplayAndVisualOutput(t *testing.T) {
	model := &scriptedModel{turns: []Turn{{Text: "private", ProviderData: json.RawMessage(`{"text":"private"}`)}}}
	result, err := (Runner{Model: model}).Run(context.Background(), RunOptions{Task: "work", Policies: []PolicyRule{{ID: "privacy", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyModelOutput {
			return PolicyDecision{Action: PolicyRedact, Replacement: "safe"}, nil
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result.Messages)
	if strings.Contains(string(raw), "private") {
		t.Fatal(string(raw))
	}
	tool := &recordingTool{result: ToolResult{Content: "caption", Computer: &ComputerOutput{Screenshot: Image{Data: []byte("private screenshot")}}}}
	model = &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}, {Text: "done"}}}
	result, err = (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Policies: []PolicyRule{{ID: "privacy", Check: func(_ context.Context, v PolicyInputValue) (PolicyDecision, error) {
		if v.Stage == PolicyToolOutput {
			if v.Result == nil || v.Result.Computer == nil {
				t.Fatal("policy did not receive visual output")
			}
			return PolicyDecision{Action: PolicyRedact, Replacement: "caption"}, nil
		}
		return PolicyDecision{Action: PolicyAllow}, nil
	}}}})
	if err != nil || len(result.Messages[2].Images) > 0 {
		t.Fatal(result, err)
	}
}
func TestCancellationBeforeToolEntryCannotPerformAnEffect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	tool := &recordingTool{}
	model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}}}
	_, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(ctx, RunOptions{Task: "work", BeforeTool: func(context.Context, ToolCall) error { cancel(); return nil }})
	if !errors.Is(err, context.Canceled) || tool.calls != 0 {
		t.Fatal(err, tool.calls)
	}
}

func TestCompletionCheckWithholdsUnverifiedStreamingFinal(t *testing.T) {
	var output string
	_, err := (Runner{Model: streamingModel{turn: Turn{Text: "unverified"}, deltas: []string{"unverified"}}}).Run(context.Background(), RunOptions{Task: "work", MaxSteps: 1, CompletionCheck: func([]Message) error { return errors.New("missing verification") }, OnEvent: func(e Event) {
		if e.Kind == EventTextDelta || e.Kind == EventText || e.Kind == EventRunFinished {
			output += e.Text
		}
	}})
	if err == nil || output != "" {
		t.Fatal(err, output)
	}
}
