package workrun

import (
	"errors"
	"sync"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

const failureRecoveryPrompt = `When a tool or specialist fails, keep ownership of the task. Inspect the returned error and available diagnostics, distinguish a transient failure from invalid arguments, missing setup, or an access boundary, and correct what you can within existing authority. Retry only when evidence suggests it can help; do not repeat an unchanged failing call. A specialist's completed transport status does not prove it completed the assignment: inspect its findings for denied tools, inaccessible paths and unperformed diagnostics. Consult list_agents capabilities before reassignment. File-only adapters cannot run host-status commands; use a configured command-capable specialist such as cli_codex for those diagnostics when permitted. Use another available permitted approach when appropriate, but honor an explicitly requested specialist or provider. If the user has already authorized fallback, proceed to that configured alternative and disclose the switch; otherwise disclose any proposed substitution. Never invent an available adapter or enable a new provider implicitly. Do not hand the problem back with "ask me to retry" while useful authorized investigation remains. Stop when the task is complete, the user stops it, the existing budget is exhausted, or further progress requires unavailable credentials, denied access, or a user decision. Never bypass permissions, change provider/account configuration without authorization, or replay an external action with an unknown outcome; inspect its receipt or reconcile first. Report the concrete blocker, recovery attempts and remaining work honestly.`

// Give foreground work one additional planning opportunity after observed
// failures. This never replays a tool or increases the run's existing budget.
type failureRecovery struct {
	mu       sync.Mutex
	failed   bool
	prompted bool
}

func (r *failureRecovery) record() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.failed = true
}

func (r *failureRecovery) check() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.failed || r.prompted {
		return nil
	}
	r.prompted = true
	return errors.New("A tool or specialist failed. Before finalizing, assess whether a useful authorized recovery step remains. " + failureRecoveryPrompt)
}

func (r *failureRecovery) completion(previous func([]agent.Message) error) func([]agent.Message) error {
	return func(messages []agent.Message) error {
		if previous != nil {
			if err := previous(messages); err != nil {
				return err
			}
		}
		return r.check()
	}
}
