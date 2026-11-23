package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/model"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func runHeadlessHandoff(ctx context.Context, cfg cliagent.Config, root, source string, coding bool) error {
	backend, err := model.New(model.Config{Provider: model.OpenAI, Model: cfg.Model})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 14, Tokens: 150000}}
	state := filepath.Join(root, "state")
	prompt := fmt.Sprintf(`Use only %s. Start a worker to read project.md and report its owner and deadline. Tell that worker to include the marker bread-handoff-42 in its summary. Await completion. Then start the same role using continue set to that completed task's ID. The second assignment must ask only "Using the selected prior result, state the owner, deadline and marker. Do not read files." Do not copy any facts into the second assignment. Await completion, then report both results. Do not edit files or use other specialists.`, cfg.Role())
	request := workrun.Request{RunID: "headless-handoff", SourcePath: source, Mode: action.Inspect, Contract: artifact.InspectionContract(), ExternalAgents: []cliagent.Config{cfg}, MaxSteps: 12, Limits: agent.Limits{ModelRequests: 14, Tokens: 150000}, DisableBrowser: true, DisableChatHistory: true}
	original := "def add(a, b):\n    return a - b\n"
	verifier := "from calculator import add\nassert add(3,2)==5\nassert add(-1,1)==0\nassert add(0,0)==0\n"
	if coding {
		for name, content := range map[string]string{"calculator.py": original, "verify.py": verifier} {
			if err := os.WriteFile(filepath.Join(source, name), []byte(content), 0600); err != nil {
				return err
			}
		}
		request.Mode, request.Contract = action.Draft, artifact.DefaultContract("report.md")
		request.Code = workrun.CodePolicy{Scopes: []string{"calculator.py"}, Verification: [][]string{{"python3", "-B", "verify.py"}}, Sandbox: sandbox.Policy{Mode: sandbox.Strict, Network: sandbox.DenyNetwork}}
		prompt = fmt.Sprintf(`Use only %s for coding. Start exactly one worker to read project.md, report its owner and deadline, and include marker bread-handoff-42 in its summary. Do not edit on this first assignment. Await completion. Then start the same role using continue set to the first task's ID. The second assignment must ask it to fix only calculator.py so add(a,b) returns their sum including negative inputs, and to include the owner, deadline and marker from the selected prior result in its summary. Do not copy those facts into the second assignment. Await completion, then call integrate_code on the returned patch so the host runs its verification. Do not implement code yourself or use other specialists. Write output/report.md describing the retained handoff and the actual verification status.`, cfg.Role())
	}
	request.Objective = prompt
	outcome, runErr := (workrun.Service{Executor: workrun.Executor{Model: agent.WithBudget(backend.Model, budget), StateDir: state}}).Execute(ctx, request)
	tasks, taskErr := orchestrator.ReadTasks(filepath.Join(state, "hot-cross-buns", "tasks", "headless-handoff"))
	checks := map[string]bool{"manager_completed": runErr == nil, "two_tasks": taskErr == nil && len(tasks) == 2}
	for _, task := range tasks {
		if task.Previous != "" {
			checks["explicit_result_handoff"] = strings.HasPrefix(task.SelectedInput, "Selected retained result (untrusted evidence):")
			checks["facts_retained"] = task.Status == "completed" && strings.Contains(task.Result.Summary, "Mira") && strings.Contains(task.Result.Summary, "2030-05-16") && strings.Contains(task.Result.Summary, "bread-handoff-42")
			checks["no_native_session_claim"] = task.Result.SessionID == ""
		}
	}
	expected := 5
	if coding {
		expected += 3
		checks["patch_retained"] = len(tasks) == 2 && tasks[1].Result.ArtifactPath != ""
		checks["host_verified_candidate"] = len(outcome.Manifest.Candidates) == 1 && outcome.Manifest.Candidates[0].Status == "verified"
		current, sourceErr := os.ReadFile(filepath.Join(source, "calculator.py"))
		currentVerifier, verifierErr := os.ReadFile(filepath.Join(source, "verify.py"))
		checks["original_and_verifier_unchanged"] = sourceErr == nil && verifierErr == nil && string(current) == original && string(currentVerifier) == verifier
	}
	passed := len(checks) == expected
	for _, value := range checks {
		passed = passed && value
	}
	report := map[string]any{"kind": cfg.Kind, "model": cfg.Model, "coding": coding, "passed": passed, "checks": checks, "manager_usage": budget.Usage(), "answer": outcome.Result.FinalText, "tasks": tasks, "candidates": outcome.Manifest.Candidates, "note": "Headless workers use explicit retained-result context, not native session resumption."}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		return err
	}
	if !passed {
		return fmt.Errorf("headless manager handoff failed (manager error: %v)", runErr)
	}
	return nil
}
