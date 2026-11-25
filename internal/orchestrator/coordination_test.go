package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDependencyPipelinePassesResultsAndKeepsConflictsVisible(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	role := hostedReader(func(_ context.Context, invocation Invocation) (Result, error) {
		switch invocation.Task {
		case "research":
			return Result{Summary: "Source A: deadline Friday"}, nil
		case "second opinion":
			return Result{Summary: "Source B: deadline Monday"}, nil
		}
		if !strings.Contains(invocation.Task, "deadline Friday") || !strings.Contains(invocation.Task, "deadline Monday") || !strings.Contains(invocation.Task, "untrusted reference data") {
			return Result{}, errors.New("reviewer did not receive both conflicting results")
		}
		return Result{Summary: "Unresolved: source deadlines disagree; inspect current source before choosing."}, nil
	})
	s, err := NewSupervisor(ctx, []Specialist{role}, Options{StatePath: t.TempDir(), ParentRun: "pipeline", Source: "source"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Start(StartRequest{Agent: "reader", Task: "research"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Start(StartRequest{Agent: "reader", Task: "second opinion"})
	if err != nil {
		t.Fatal(err)
	}
	review, err := s.Start(StartRequest{Agent: "reader", Task: "review evidence", Dependencies: []string{first.ID, second.ID}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.Await(ctx, review.ID)
	if err != nil || result.Status != "completed" || !strings.Contains(result.Result.Summary, "Unresolved") {
		t.Fatalf("review: %+v, %v", result, err)
	}
	if result.InputSHA256 != digest(result.SelectedInput) || !strings.Contains(result.SelectedInput, "pipeline/"+first.ID) {
		t.Fatal("dependency inputs were not retained with their identity")
	}
	if err := s.CheckCompletion(); err != nil {
		t.Fatal(err)
	}
}

func TestFailedDependencyNeverRunsItsDependentAndCompletionWaitsForActiveWork(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	release := make(chan struct{})
	role := hostedReader(func(ctx context.Context, invocation Invocation) (Result, error) {
		if invocation.Task != "fail" {
			t.Error("dependent ran after its prerequisite failed")
		}
		select {
		case <-release:
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
		return Result{}, errors.New("source unavailable")
	})
	s, err := NewSupervisor(ctx, []Specialist{role}, Options{StatePath: t.TempDir(), ParentRun: "failed-pipeline", Source: "source"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, _ := s.Start(StartRequest{Agent: "reader", Task: "fail"})
	dependent, err := s.Start(StartRequest{Agent: "reader", Task: "must not run", Dependencies: []string{first.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if s.CheckCompletion() == nil {
		t.Fatal("manager completed while delegated work was active")
	}
	close(release)
	result, err := s.Await(ctx, dependent.ID)
	if err != nil || result.Category != "dependency" || !strings.Contains(result.Error, first.ID) {
		t.Fatalf("dependency failure: %+v %v", result, err)
	}
}

func TestEscapedDependencyResultsStayBoundedAndMarkOmittedText(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ids := []string{}
	role := hostedReader(func(_ context.Context, invocation Invocation) (Result, error) {
		if invocation.Task == "produce" {
			return Result{Summary: strings.Repeat("\"\\\n", 5000)}, nil
		}
		if len(invocation.Task) > 41*1024 || !strings.Contains(invocation.Task, `"truncated":true`) {
			return Result{}, errors.New("escaped dependency input was unbounded or silently omitted text")
		}
		for _, id := range ids {
			if !strings.Contains(invocation.Task, id) {
				return Result{}, errors.New("bounded context dropped a dependency identity")
			}
		}
		return Result{Summary: "Reviewed bounded predecessor results."}, nil
	})
	s, err := NewSupervisor(ctx, []Specialist{role}, Options{StatePath: t.TempDir(), ParentRun: "escaped-pipeline", Source: "source", MaxDelegations: 9})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for range 8 {
		task, err := s.Start(StartRequest{Agent: "reader", Task: "produce"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	review, err := s.Start(StartRequest{Agent: "reader", Task: "review", Dependencies: ids})
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.Await(ctx, review.ID)
	if err != nil || result.Status != "completed" {
		t.Fatal(result, err)
	}
}
