package continuity

import (
	"context"
	"errors"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

// Maintain creates at most two source-linked summary sections/overviews. Callers
// run it off the reply path, with a profile lease and a bounded inference budget.
// check must revalidate the captured processing destination before each call.
func Maintain(ctx context.Context, stateDir string, model agent.Model, options Options, check func() error) (bool, error) {
	sessions, err := worksession.Open(stateDir)
	if err != nil {
		return false, err
	}
	memories, err := memory.Open(stateDir)
	if err != nil {
		return false, err
	}
	records, err := memories.List(options.GoalID, true)
	if err != nil && memory.ReadWarning(err) == "" {
		return false, err
	}
	rules, err := memories.WithdrawalRules(options.GoalID)
	if err != nil {
		return false, err
	}
	epoch := hash(struct {
		Records []memory.Record
		Rules   []memory.WithdrawalRule
	}{records, rules})
	validate := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if check != nil {
			if err := check(); err != nil {
				return err
			}
		}
		latest, err := memories.List(options.GoalID, true)
		if err != nil && memory.ReadWarning(err) == "" {
			return err
		}
		latestRules, err := memories.WithdrawalRules(options.GoalID)
		if err != nil {
			return err
		}
		if hash(struct {
			Records []memory.Record
			Rules   []memory.WithdrawalRule
		}{latest, latestRules}) != epoch {
			return errors.New("memory privacy or source versions changed during summary maintenance")
		}
		return nil
	}
	if err := validate(); err != nil {
		return false, err
	}
	options.maintain = true
	options.validate = validate
	guarded := maintenanceModel{model: model, check: validate}
	result, err := prepareArchive(ctx, sessions, memories, guarded, records, rules, options)
	if err != nil {
		return false, err
	}
	if result.maintenanceErr != nil {
		return false, result.maintenanceErr
	}
	if err := validate(); err != nil {
		return false, err
	}
	return result.worked, nil
}

type maintenanceModel struct {
	model agent.Model
	check func() error
}

func (m maintenanceModel) ContextPolicy() agent.ContextPolicy { return agent.ContextFor(m.model) }
func (m maintenanceModel) Complete(ctx context.Context, r agent.TurnRequest) (agent.Turn, error) {
	if err := m.check(); err != nil {
		return agent.Turn{}, err
	}
	turn, err := m.model.Complete(ctx, r)
	if err != nil {
		return turn, err
	}
	if err := m.check(); err != nil {
		return agent.Turn{}, err
	}
	return turn, nil
}
