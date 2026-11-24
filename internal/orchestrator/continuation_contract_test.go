package orchestrator

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

type continuationRepairModel struct {
	t              *testing.T
	step           int
	previous, next string
}

func (m *continuationRepairModel) Complete(_ context.Context, request agent.TurnRequest) (agent.Turn, error) {
	m.step++
	call := agent.ToolCall{ID: "repair", Name: "start_agent"}
	switch m.step {
	case 1:
		call.Arguments = json.RawMessage(`{"agent":"reader","task":"follow-up continue=` + m.previous + `"}`)
	case 2:
		if !strings.Contains(request.Messages[len(request.Messages)-1].Content, "No worker was started") {
			m.t.Fatal("missing actionable tool error")
		}
		call.Arguments = json.RawMessage(`{"agent":"reader","task":"follow-up","continue":"` + m.previous + `"}`)
	case 3:
		var task Task
		if err := json.Unmarshal([]byte(request.Messages[len(request.Messages)-1].Content), &task); err != nil {
			m.t.Fatal(err)
		}
		if task.Previous != m.previous || task.Attempt != 2 {
			m.t.Fatalf("wrong continuation: %+v", task)
		}
		m.next = task.ID
		call.Name = "await_agent"
		call.Arguments = json.RawMessage(`{"id":"` + task.ID + `","timeout_seconds":1}`)
	default:
		return agent.Turn{Text: "Follow-up verified."}, nil
	}
	return agent.Turn{ToolCalls: []agent.ToolCall{call}}, nil
}

func TestManagerRepairsMissingContinuationWithoutStartingFreshWorker(t *testing.T) {
	invocations := make(chan Invocation, 2)
	role := hostedReader(func(_ context.Context, input Invocation) (Result, error) {
		invocations <- input
		return Result{SessionID: "native-thread", Summary: "retained fact"}, nil
	})
	role.Sessions = true
	s, err := NewSupervisor(context.Background(), []Specialist{role}, Options{StatePath: t.TempDir(), ParentRun: "repair", Source: "snapshot", MaxDelegations: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Start(StartRequest{Agent: "reader", Task: "first"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Await(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	model := &continuationRepairModel{t: t, previous: first.ID}
	runner := agent.Runner{Model: model, Tools: s.Tools()}
	result, err := runner.Run(context.Background(), agent.RunOptions{Task: "Continue the existing reader", MaxSteps: 4})
	if err != nil || result.FinalText == "" {
		t.Fatal(result, err)
	}
	<-invocations
	followup := <-invocations
	if followup.SessionID != "native-thread" || followup.Task != "follow-up" {
		t.Fatalf("lost native handoff: %+v", followup)
	}
	if s.used != 2 {
		t.Fatalf("malformed call consumed worker budget: %d", s.used)
	}
}

func TestStartAgentRequiresExplicitFreshOrRetainedContext(t *testing.T) {
	s, err := NewSupervisor(context.Background(), []Specialist{hostedReader(func(context.Context, Invocation) (Result, error) { return Result{}, nil })}, Options{StatePath: t.TempDir(), ParentRun: "fresh", Source: "snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	tool := taskTool{s, "start_agent"}
	for _, raw := range []string{`{"agent":"reader","task":"new"}`, `{"agent":"reader","task":"new","continue":null}`} {
		if _, err := tool.Execute(context.Background(), []byte(raw)); err == nil || !strings.Contains(err.Error(), "explicit continue") {
			t.Fatalf("missing contract: %v", err)
		}
	}
	if _, err := tool.Execute(context.Background(), []byte(`{"agent":"reader","task":"new","continue":""}`)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tool.Definition().Parameters), `"required":["agent","task","continue"]`) {
		t.Fatal("schema does not require context selection")
	}
}
