package orchestrator

import (
	"context"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

func WithHostedPolicy(specialist Specialist, rules []agent.PolicyRule) Specialist {
	if len(rules) == 0 {
		return specialist
	}
	run := specialist.Run
	specialist.Run = func(ctx context.Context, invocation Invocation) (Result, error) {
		if _, err := agent.CheckHostPolicy(ctx, rules, agent.PolicyInput, invocation.Task); err != nil {
			return Result{}, err
		}
		result, err := run(ctx, invocation)
		// Rebuild the envelope from the filtered result at the supervisor boundary.
		result.Completion = nil
		summary, policyErr := agent.CheckHostPolicy(ctx, rules, agent.PolicyModelOutput, result.Summary)
		if policyErr != nil {
			result.Summary = ""
			return result, policyErr
		}
		result.Summary = summary
		if err == nil {
			summary, policyErr = agent.CheckHostPolicy(ctx, rules, agent.PolicyFinal, result.Summary)
			if policyErr != nil {
				result.Summary = ""
				return result, policyErr
			}
			result.Summary = summary
		}
		return result, err
	}
	return specialist
}
