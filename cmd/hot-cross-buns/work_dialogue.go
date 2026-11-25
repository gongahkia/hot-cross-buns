package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"maps"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/continuity"
	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	sharedusage "github.com/gongahkia/hot-cross-buns/internal/usage"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

// Capture account and capability configuration locally, without sending another
// account probe or recording credentials in a conversation. The existing runtime
// also enforces the captured OAuth grant pins when each connector is used.
func captureConversationInput(input workapp.ConversationInput) (workapp.ConversationInput, error) {
	return captureConversationSetup(input, false)
}

// Conversation admission can retain unavailable selections without granting
// source access. The router has no tools; execution uses the strict capture.
func captureConversationAdmission(input workapp.ConversationInput) (workapp.ConversationInput, error) {
	return captureConversationSetup(input, true)
}

// Missing selections are bounded references, never fabricated descriptors.
func captureConversationSetup(input workapp.ConversationInput, allowMissing bool) (workapp.ConversationInput, error) {
	settings, err := loadSettings()
	if err != nil {
		return input, err
	}
	registry, err := connector.NewRegistry(settings.Connectors)
	if err != nil {
		return input, err
	}
	credentials, err := hotCrossBunsCredentials()
	if err != nil {
		return input, err
	}
	selected := []connector.Descriptor{}
	missing := []string{}
	grants := map[string]string{}
	pins := map[string]string{}
	credentialPins := map[string]string{}
	for _, id := range input.RunOptions.ConnectorIDs {
		descriptor, ok := registry.Get(id)
		if !ok {
			if allowMissing {
				missing = append(missing, id)
				continue
			}
			return input, fmt.Errorf("selected source %q is no longer configured", id)
		}
		selected = append(selected, descriptor)
		credential, found, err := credentials.Read(descriptor.CredentialRef())
		if err != nil {
			return input, err
		}
		if !found && descriptor.Authentication == connector.AuthNone {
			credentialPins[id] = connector.CredentialPin(descriptor, auth.Credential{})
		}
		if found {
			credentialPins[id] = connector.CredentialPin(descriptor, credential)
			data, err := json.Marshal(credential)
			if err != nil {
				return input, err
			}
			if descriptor.Authentication == connector.AuthOAuth && credential.Refresh != "" {
				pins[id] = connector.OAuthGrantPin(descriptor, credential.Refresh)
				grants[id] = pins[id]
			} else {
				grants[id] = fmt.Sprintf("%x", sha256.Sum256(data))
			}
		}
	}
	// These settings can change execution authority or processing destination.
	// Cosmetic preferences/default-model changes do not invalidate captured work.
	scope := map[string]any{"embeddings": settings.Embeddings, "connectors": selected, "grants": grants, "permissions": settings.ConnectorPermissions, "endpoints": settings.ProviderEndpoints, "provider_options": settings.ProviderOptions, "custom_providers": settings.CustomProviders, "extensions": settings.Extensions, "extension_trusts": settings.ExtensionTrusts, "hooks": settings.HookTrusts, "lsp": settings.LSPTrusts, "mcp": settings.MCPTrusts, "execution": settings.Execution, "roles": settings.WorkRoles, "external_agents": settings.ExternalAgents}
	if len(missing) > 0 {
		scope["missing_sources"] = missing
	}
	data, err := json.Marshal(scope)
	if err != nil {
		return input, err
	}
	processing := map[string]any{}
	for key, value := range scope {
		if key != "connectors" && key != "grants" && key != "permissions" && key != "missing_sources" {
			processing[key] = value
		}
	}
	processingData, _ := json.Marshal(processing)
	input.ProcessingDigest = fmt.Sprintf("%x", sha256.Sum256(processingData))
	input.CredentialPins = credentialPins
	input.ScopeDigest = fmt.Sprintf("%x", sha256.Sum256(data))
	input.OAuthRefreshPins = pins
	return input, nil
}

func verifyConversationScope(input workapp.ConversationInput) error {
	return verifyConversationScopeFor(input, false)
}

func verifyConversationScopeFor(input workapp.ConversationInput, conversationOnly bool) error {
	current, err := captureConversationSetup(input, conversationOnly)
	if err != nil {
		return err
	}
	if input.ScopeDigest == "" || input.ScopeDigest != current.ScopeDigest || !maps.Equal(input.OAuthRefreshPins, current.OAuthRefreshPins) {
		return errors.New("accounts, permissions or processing configuration changed after this message; review the retained task and send a new request")
	}
	return nil
}

func routeInteractiveConversation(stateDir string) func(context.Context, workrun.ConversationRequest, workapp.ConversationInput) (workrun.ConversationDecision, error) {
	return func(ctx context.Context, request workrun.ConversationRequest, input workapp.ConversationInput) (workrun.ConversationDecision, error) {
		if err := verifyConversationScopeFor(input, true); err != nil {
			return workrun.ConversationDecision{}, err
		}
		if err := ctx.Err(); err != nil {
			return workrun.ConversationDecision{}, err
		}
		if decision, ok := workrun.QuickAcknowledgement(request); ok {
			return decision, nil
		}
		provider, model, err := resolveConfiguredProvider(input.RunOptions.ModelProvider, input.RunOptions.ModelName)
		if err != nil {
			return workrun.ConversationDecision{}, err
		}
		backend, err := nativeWorkModel(provider, model, "")
		if err != nil {
			return workrun.ConversationDecision{}, err
		}
		if input.ConversationID != "" {
			context, err := prepareDialogueContinuity(ctx, stateDir, backend, request.Text, input)
			if err != nil {
				return workrun.ConversationDecision{}, err
			}
			request.Recent = nil
			for _, message := range context.Recent {
				request.Recent = append(request.Recent, workrun.ConversationMessage{Role: message.Role, Text: message.Text})
			}
			context.Recent = nil
			data, err := json.Marshal(context)
			if err != nil {
				return workrun.ConversationDecision{}, err
			}
			request.Continuity = string(data)
			settings, err := loadSettings()
			if err != nil {
				return workrun.ConversationDecision{}, err
			}
			request.LearnFromChats = settings.Desktop.LearnsFromChats()
			request.ReferToChats = settings.Desktop.RefersToChats()
		}
		return workrun.RouteConversation(sharedusage.WithState(sharedusage.WithCategory(ctx, "routing"), stateDir), backend, request)
	}
}

func prepareDialogueContinuity(ctx context.Context, stateDir string, model agent.Model, text string, input workapp.ConversationInput) (continuity.Context, error) {
	if _, err := personalization.SyncMarkdown(stateDir); err != nil {
		return continuity.Context{}, fmt.Errorf("review local memory file edits: %w", err)
	}
	release, err := state.Guard(stateDir, false)
	if err != nil {
		return continuity.Context{}, err
	}
	defer release()
	if err := verifyConversationScopeFor(input, true); err != nil {
		return continuity.Context{}, err
	}
	settings, err := loadSettings()
	if err != nil {
		return continuity.Context{}, err
	}
	sessions, err := worksession.Open(stateDir)
	if err != nil {
		return continuity.Context{}, err
	}
	chat, err := sessions.Load(input.ConversationID)
	if err != nil {
		return continuity.Context{}, err
	}
	if chat.SourcePath != input.Source {
		return continuity.Context{}, errors.New("conversation continuity source changed")
	}
	main, err := sessions.Primary()
	if err != nil {
		return continuity.Context{}, err
	}
	var recent []continuity.Message
	for _, message := range input.Recent {
		recent = append(recent, continuity.Message{Role: message.Role, Text: message.Text})
	}
	var reports []continuity.Report
	for _, task := range input.TaskContext {
		reports = append(reports, continuity.Report{ID: task.ID, Title: continuity.Clip(task.Title, 256), State: task.State, Summary: continuity.Clip(task.Summary, 1024)})
	}
	embedder, _ := configuredHistoryEmbedder(stateDir, settings)
	result, err := continuity.Build(sharedusage.WithState(sharedusage.WithCategory(ctx, "retrieval"), stateDir), stateDir, model, continuity.Options{
		Embedder: embedder, AdmittedRecent: recent, Reports: reports,
		ConversationID: input.ConversationID, GoalID: input.GoalID, Query: text, BeforeSequence: input.BeforeSequence, BeforeTime: input.BeforeTime,
		Excluded: input.RunOptions.ExcludedKnowledgeIDs, Main: main == input.ConversationID, ReferToChats: settings.Desktop.RefersToChats(), LearnFromChats: settings.Desktop.LearnsFromChats(),
	})
	if err != nil {
		return continuity.Context{}, err
	}
	if err := verifyConversationScopeFor(input, true); err != nil {
		return continuity.Context{}, err
	}
	return result, nil
}

// Execution uses the child's own lease/replay/approval owner. Parent context is
// a bounded public reference, never the parent's replay or authorization.
func resolveDialogueExecution(stateDir, source, conversation, text string, options workapp.RunOptions) (*workapp.ConversationInput, goal.Record, error) {
	return resolveDialogueExecutionScope(stateDir, source, conversation, text, options, false)
}
func resolveDialogueExecutionForPreparation(stateDir, source, conversation, text string, options workapp.RunOptions) (*workapp.ConversationInput, goal.Record, error) {
	return resolveDialogueExecutionScope(stateDir, source, conversation, text, options, true)
}
func resolveDialogueExecutionScope(stateDir, source, conversation, text string, options workapp.RunOptions, unstarted bool) (*workapp.ConversationInput, goal.Record, error) {
	if options.DialogueParent == "" && options.DialogueTurn == "" {
		return nil, goal.Record{}, nil
	}
	store, err := worksession.Open(stateDir)
	if err != nil {
		return nil, goal.Record{}, err
	}
	origin, err := store.DialogueTask(conversation)
	if err != nil {
		return nil, goal.Record{}, err
	}
	if origin == nil || origin.ParentConversationID != options.DialogueParent || origin.TurnID != options.DialogueTurn {
		return nil, goal.Record{}, errors.New("independent task origin changed")
	}
	turn, err := store.ReadDialogue(options.DialogueParent, options.DialogueTurn)
	if err != nil {
		return nil, goal.Record{}, err
	}
	var input workapp.ConversationInput
	if json.Unmarshal(turn.Options, &input) != nil || input.Version != 1 || input.Source != source || turn.Text != text || turn.TaskChat != conversation {
		return nil, goal.Record{}, errors.New("independent task inputs changed")
	}
	if input.ConversationID != "" && input.ConversationID != origin.ParentConversationID {
		return nil, goal.Record{}, errors.New("requesting conversation changed")
	}
	input.ConversationID, input.BeforeSequence, input.BeforeTime = origin.ParentConversationID, turn.Sequence, turn.CreatedAt
	expected := input.RunOptions
	var decision workrun.ConversationDecision
	if json.Unmarshal(turn.Decision, &decision) != nil {
		return nil, goal.Record{}, errors.New("the retained routing decision is unavailable")
	}
	if decision.Kind == "plan" {
		expected.PlanFirst = true
		input.RunOptions.PlanFirst = true
	}
	expected.DialogueParent, expected.DialogueTurn = options.DialogueParent, options.DialogueTurn
	a, err := json.Marshal(expected)
	if err != nil {
		return nil, goal.Record{}, err
	}
	b, err := json.Marshal(options)
	if err != nil {
		return nil, goal.Record{}, err
	}
	if string(a) != string(b) {
		journal, err := store.LoadRequests(conversation)
		if err != nil {
			return nil, goal.Record{}, err
		}
		matched := false
		for _, retained := range journal.Requests {
			if retained.ClientID == origin.TurnID && retained.Text == text && worksession.MatchesPlanInputEvolution(retained, a, b) {
				matched = true
			}
		}
		if !matched {
			return nil, goal.Record{}, errors.New("independent task execution settings changed")
		}
	}
	// A source/account transition is authority only when retained in the
	// original request's digest-bound scope chain after explicit human review.
	journal, err := store.LoadRequests(conversation)
	if err != nil {
		return nil, goal.Record{}, err
	}
	for _, retained := range journal.Requests {
		if retained.ClientID != origin.TurnID || retained.Text != text || !worksession.MatchesPlanInputEvolution(retained, a, b) {
			continue
		}
		if access := retained.Plan.LatestAccessChange(); access != nil {
			first := ""
			for _, change := range retained.Plan.InputChanges {
				if change.Access != nil {
					first = change.Access.BeforeScope
					break
				}
			}
			if first != input.ScopeDigest || input.ProcessingDigest == "" || access.ProcessingDigest != input.ProcessingDigest {
				return nil, goal.Record{}, errors.New("reviewed account access does not match the original task")
			}
			input.RunOptions = options
			input.ScopeDigest = access.AfterScope
			input.OAuthRefreshPins = access.OAuthPins
			input.CredentialPins = access.CredentialPins
		}
	}
	if unstarted {
		current, err := captureConversationSetup(input, true)
		if err != nil {
			return nil, goal.Record{}, err
		}
		if input.ProcessingDigest == "" || input.ProcessingDigest != current.ProcessingDigest {
			return nil, goal.Record{}, errors.New("original task processing configuration changed before preparation")
		}
	} else if err := verifyConversationScope(input); err != nil {
		return nil, goal.Record{}, err
	}
	var record goal.Record
	if input.GoalID != "" {
		goals, err := goal.Open(stateDir)
		if err != nil {
			return nil, record, err
		}
		record, err = goals.Load(input.GoalID)
		if err != nil {
			return nil, record, err
		}
		if record.Status != goal.Active || record.SourcePath != source || record.ConversationID != options.DialogueParent {
			return nil, record, errors.New("the original goal or its workspace changed; inspect it before starting new work")
		}
	}
	return &input, record, nil
}
