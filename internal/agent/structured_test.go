package agent

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestStructuredContractRepairsOnceWithoutToolsOrAuthority(t *testing.T) {
	type decision struct {
		Kind string `json:"kind"`
	}
	model := &scriptedModel{turns: []Turn{{Text: `{"kind":"bad","kind":"ok"}`}, {Text: `{"kind":"ok"}`}}}
	contract := OutputContract{Name: "decision", Schema: json.RawMessage(`{"type":"object"}`)}
	got, err := CompleteStructured(context.Background(), model, TurnRequest{}, contract, func(d decision) error {
		if d.Kind != "ok" {
			return errors.New("bad kind")
		}
		return nil
	})
	if err != nil || got.Kind != "ok" {
		t.Fatal(got, err)
	}
	for _, text := range []string{`{"kind":"ok","extra":true}`, `{"kind":"ok"} {}`, `{"kind":"bad","kind":"ok"}`} {
		if _, err := DecodeStructured[decision](Turn{Text: text}, 1024, nil); err == nil {
			t.Fatal("accepted ambiguous output", text)
		}
	}
	model = &scriptedModel{turns: []Turn{{Text: `not JSON`}, {Text: `not JSON`}}}
	if _, err := CompleteStructured[decision](context.Background(), model, TurnRequest{}, contract, nil); !errors.Is(err, ErrStructuredOutput) {
		t.Fatal(err)
	}
}

func TestCompletionEnvelopeDoesNotTurnPartialWorkIntoSuccess(t *testing.T) {
	result := CompletionResult("Some findings", []string{"source/a.md", "source/a.md"}, errors.New("provider failed"))
	if result.Status != "partial" || !result.FollowUpRequired || len(result.Evidence) != 1 {
		t.Fatal(result)
	}
	result = CompletionResult("Done", nil, context.Canceled)
	if result.Status != "cancelled" {
		t.Fatal(result)
	}
}
