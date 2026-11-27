package orchestrator

import (
	"context"
	"errors"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

func TestHostedWorkersUseHostInputAndOutputPolicy(t *testing.T) {
	called := false
	worker := Specialist{Run: func(context.Context, Invocation) (Result, error) {
		called = true
		envelope := agent.CompletionResult("private", nil, nil)
		return Result{Summary: "private", Completion: &envelope}, nil
	}}
	blocked := WithHostedPolicy(worker, []agent.PolicyRule{{ID: "host", Check: func(context.Context, agent.PolicyInputValue) (agent.PolicyDecision, error) {
		return agent.PolicyDecision{Action: agent.PolicyBlock}, nil
	}}})
	if _, err := blocked.Run(context.Background(), Invocation{Task: "work"}); !errors.Is(err, agent.ErrPolicy) || called {
		t.Fatal(err, called)
	}
	redacted := WithHostedPolicy(worker, []agent.PolicyRule{{ID: "host", Check: func(_ context.Context, v agent.PolicyInputValue) (agent.PolicyDecision, error) {
		if v.Stage == agent.PolicyModelOutput {
			return agent.PolicyDecision{Action: agent.PolicyRedact, Replacement: "safe"}, nil
		}
		return agent.PolicyDecision{Action: agent.PolicyAllow}, nil
	}}})
	result, err := redacted.Run(context.Background(), Invocation{Task: "work"})
	if err != nil || result.Summary != "safe" || result.Completion != nil || !called {
		t.Fatal(result, err, called)
	}
}
