package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/continuity"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	sharedusage "github.com/gongahkia/hot-cross-buns/internal/usage"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

type summaryMaintenanceRequest struct {
	Input        workapp.ConversationInput `json:"input"`
	Before       uint64                    `json:"before"`
	At           time.Time                 `json:"at"`
	Refer, Learn bool
}

var errSummaryScope = errors.New("summary maintenance scope changed; waiting for a fresh conversation request")

func enqueueSummaryMaintenance(ctx context.Context, stateDir string, input workapp.ConversationInput) error {
	settings, err := loadSettings()
	if err != nil {
		return err
	}
	request := summaryMaintenanceRequest{Input: workapp.ConversationInput{Version: 1, ConversationID: input.ConversationID, Source: input.Source, GoalID: input.GoalID, ScopeDigest: input.ScopeDigest, ProcessingDigest: input.ProcessingDigest, OAuthRefreshPins: input.OAuthRefreshPins, RunOptions: workapp.RunOptions{ModelProvider: input.RunOptions.ModelProvider, ModelName: input.RunOptions.ModelName, ConnectorIDs: input.RunOptions.ConnectorIDs, ExcludedKnowledgeIDs: input.RunOptions.ExcludedKnowledgeIDs}}, Before: input.BeforeSequence, At: input.BeforeTime, Refer: settings.Desktop.RefersToChats(), Learn: settings.Desktop.LearnsFromChats()}
	identity := request
	identity.Before = 0
	identity.At = time.Time{}
	data, err := json.Marshal(identity)
	if err != nil {
		return err
	}
	key := fmt.Sprintf("%x", sha256.Sum256(data))
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	store, err := worksession.Open(stateDir)
	if err != nil {
		return err
	}
	return store.QueueHistoryMaintenance(ctx, input.ConversationID, key, payload, time.Now())
}

func runSummaryMaintenance(ctx context.Context, stateDir string) error {
	release, err := state.Guard(stateDir, false)
	if err != nil {
		return err
	}
	defer release()
	store, err := worksession.Open(stateDir)
	if err != nil {
		return err
	}
	job, found, err := store.ClaimHistoryMaintenance(ctx, time.Now())
	if err != nil || !found {
		return err
	}
	bounded, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var request summaryMaintenanceRequest
	check := func() error {
		if len(job.Payload) > 64*1024 || json.Unmarshal(job.Payload, &request) != nil || request.Input.ConversationID != job.Chat || request.Input.Version != 1 || request.Input.RunOptions.ModelProvider == "" || request.Input.RunOptions.ModelName == "" {
			return errSummaryScope
		}
		chat, err := store.Load(job.Chat)
		if err != nil || chat.SourcePath != request.Input.Source {
			return errSummaryScope
		}
		settings, err := loadSettings()
		if err != nil {
			return err
		}
		if settings.Desktop.RefersToChats() != request.Refer || settings.Desktop.LearnsFromChats() != request.Learn {
			return errSummaryScope
		}
		if verifyConversationScopeFor(request.Input, true) != nil {
			return errSummaryScope
		}
		return nil
	}
	failure := check()
	more := false
	if failure == nil {
		model, err := nativeWorkModel(request.Input.RunOptions.ModelProvider, request.Input.RunOptions.ModelName, "")
		failure = err
		if err == nil {
			model = agent.WithBudget(model, &agent.Budget{Limits: agent.Limits{ModelRequests: 8, Tokens: 200000}})
			more, failure = continuity.Maintain(sharedusage.WithState(sharedusage.WithCategory(bounded, "summary_maintenance"), stateDir), stateDir, model, continuity.Options{ConversationID: job.Chat, GoalID: request.Input.GoalID, BeforeSequence: request.Before, BeforeTime: request.At, Excluded: request.Input.RunOptions.ExcludedKnowledgeIDs}, check)
		}
	}
	if errors.Is(failure, agent.ErrBudget) {
		failure = nil
		more = true
	}
	if errors.Is(failure, errSummaryScope) {
		failure = nil
		more = false
	}
	// Release the claim even on host cancellation; a crashed host recovers by lease expiry.
	finish, cancelFinish := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFinish()
	if err := store.FinishHistoryMaintenance(finish, job, time.Now(), more, failure); err != nil {
		return err
	}
	return failure
}

func summaryMaintenanceLoop(ctx context.Context, stateDir string) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = runSummaryMaintenance(ctx, stateDir)
		}
	}
}
