package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func introductionFixture(t *testing.T) (string, config.Store, worksession.Store, config.IntroductionChat) {
	t.Helper()
	state := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	store, err := config.DefaultStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(config.Default()); err != nil {
		t.Fatal(err)
	}
	sessions, _ := worksession.Open(state)
	chat, err := sessions.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	result := introductionAction(state, store, personalization.CatalogAction{Action: "intro_start", ConversationID: chat.ID})
	if result.Error != "" {
		t.Fatal(result.Error)
	}
	settings, _ := store.Load()
	return state, store, sessions, *settings.Desktop.IntroductionChat
}

func TestIntroductionConversationCollectsBeforeOneConfirmedSaveAndSurvivesReopen(t *testing.T) {
	state, store, sessions, intake := introductionFixture(t)
	first, err := sessions.AdmitDialogue(intake.ConversationID, "introduction-first-message", "My name is Alice.", json.RawMessage(`{"version":1}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	model := &workScriptedModel{turns: []agent.Turn{{Text: `{"kind":"reply","reply":"Nice to meet you, Alice. How would you like me to reply?"}`}, {Text: `{"kind":"propose","answers":{"profile.name":"My name is Alice.","preference.tone":"Casual and concise","profile.projects":"A garden project"}}`}}}
	question, handled, err := answerIntroduction(context.Background(), state, store, intake, workrun.ConversationRequest{Text: first.Text}, workapp.ConversationInput{BeforeSequence: first.Sequence, BeforeTime: first.CreatedAt}, model)
	if err != nil || !handled || !strings.Contains(question.Text, "How would") {
		t.Fatal(question, handled, err)
	}
	memories, _ := memory.Open(state)
	records, _ := memories.List("", true)
	if len(records) != 0 {
		t.Fatal("saved before collecting answers")
	}
	second, err := sessions.AdmitDialogue(intake.ConversationID, "introduction-second-message", "Casual and concise. A garden project.", json.RawMessage(`{"version":1}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	proposal, _, err := answerIntroduction(context.Background(), state, store, intake, workrun.ConversationRequest{Text: second.Text}, workapp.ConversationInput{BeforeSequence: second.Sequence, BeforeTime: second.CreatedAt}, model)
	if err != nil || !strings.Contains(proposal.Text, "Want me to save these together?") {
		t.Fatal(proposal, err)
	}
	records, _ = memories.List("", true)
	if len(records) != 0 {
		t.Fatal("proposal became memory without confirmation")
	}
	settings, _ := store.Load()
	staged := *settings.Desktop.IntroductionChat
	if len(staged.Proposal) != 3 {
		t.Fatal("answers not collected", staged)
	}
	duplicate := introductionAction(state, store, personalization.CatalogAction{Action: "intro_start", ConversationID: "work-another"})
	settings, _ = store.Load()
	if duplicate.Error != "" || settings.Desktop.IntroductionChat.ConversationID != intake.ConversationID || !settings.Desktop.IntroductionChat.StartedAt.Equal(intake.StartedAt) {
		t.Fatal("reopening repeated onboarding")
	}
	confirmed, _, err := confirmIntroduction(context.Background(), state, store, staged)
	if err != nil || !strings.Contains(confirmed.Text, "Saved to memory") {
		t.Fatal(confirmed, err)
	}
	records, _ = memories.List("", true)
	if len(records) != 3 {
		t.Fatal("missing combined save", len(records))
	}
	settings, _ = store.Load()
	if settings.Desktop.Introduction != "completed" || len(settings.Desktop.IntroductionChat.Proposal) != 0 {
		t.Fatal("intake did not close")
	}
	if _, _, err := confirmIntroduction(context.Background(), state, store, staged); err == nil {
		t.Fatal("old confirmation replayed")
	}
	other, handled, err := routeIntroduction(context.Background(), state, workrun.ConversationRequest{Text: "Hi"}, workapp.ConversationInput{ConversationID: intake.ConversationID})
	if handled || err != nil || other.Kind != "" {
		t.Fatal("completed intake intercepted chat", other, err)
	}
}

func TestIntroductionRejectsInventedPriorChatAndSecretQuotes(t *testing.T) {
	for _, quote := range []string{"Invented preference", "a hidden fact from another chat", "sk-abcdefghijklmnopqrstuvwxyz0123456789"} {
		t.Run(quote, func(t *testing.T) {
			state, store, _, intake := introductionFixture(t)
			data, _ := json.Marshal(map[string]any{"kind": "propose", "answers": map[string]string{"preference.tone": quote}})
			model := &workScriptedModel{turns: []agent.Turn{{Text: string(data)}}}
			text := "Keep things casual."
			if strings.HasPrefix(quote, "sk-") {
				text = "My API key is " + quote
			}
			if _, _, err := answerIntroduction(context.Background(), state, store, intake, workrun.ConversationRequest{Text: text}, workapp.ConversationInput{}, model); err == nil {
				t.Fatal("unsafe quote admitted")
			}
			settings, _ := store.Load()
			if len(settings.Desktop.IntroductionChat.Proposal) != 0 {
				t.Fatal("unsafe proposal retained")
			}
		})
	}
}

func TestIntroductionCanSkipOrYieldToOrdinaryTasksWithoutSaving(t *testing.T) {
	for _, kind := range []string{"skip", "continue"} {
		t.Run(kind, func(t *testing.T) {
			state, store, _, intake := introductionFixture(t)
			model := &workScriptedModel{turns: []agent.Turn{{Text: `{"kind":"` + kind + `"}`}}}
			_, handled, err := answerIntroduction(context.Background(), state, store, intake, workrun.ConversationRequest{Text: "Let’s move on."}, workapp.ConversationInput{}, model)
			if err != nil || handled != (kind == "skip") {
				t.Fatal(handled, err)
			}
			settings, _ := store.Load()
			if settings.Desktop.Introduction != "skipped" {
				t.Fatal("kept asking")
			}
			memories, _ := memory.Open(state)
			records, _ := memories.List("", true)
			if len(records) != 0 {
				t.Fatal("saved declined intake")
			}
		})
	}
	for _, text := range []string{"yes please", "Save these", "yeah", "okay"} {
		if !introductionConsent.MatchString(text) {
			t.Fatal("ordinary consent rejected", text)
		}
	}
	for _, text := range []string{"yes but don't save", "not yet", "sure, but change my name", "no", "approve the pending task"} {
		if introductionConsent.MatchString(text) {
			t.Fatal("ambiguous consent accepted", text)
		}
	}
}

func TestIntroductionCorrectionClearsPriorConsentAndStaleProfileNeedsNewReview(t *testing.T) {
	state, store, _, intake := introductionFixture(t)
	intake.Proposal = map[string]string{"profile.name": "Alice"}
	if err := store.Update(func(s *config.Settings) error { s.Desktop.IntroductionChat = &intake; return nil }); err != nil {
		t.Fatal(err)
	}
	model := &workScriptedModel{turns: []agent.Turn{{Text: `{"kind":"reply","reply":"What should I call you instead?"}`}}}
	if _, _, err := answerIntroduction(context.Background(), state, store, intake, workrun.ConversationRequest{Text: "Actually, change that name."}, workapp.ConversationInput{}, model); err != nil {
		t.Fatal(err)
	}
	settings, _ := store.Load()
	if len(settings.Desktop.IntroductionChat.Proposal) != 0 {
		t.Fatal("later yes can approve superseded answer")
	}
	if _, _, err := confirmIntroduction(context.Background(), state, store, intake); err == nil {
		t.Fatal("superseded proposal accepted")
	}
	if err := store.Update(func(s *config.Settings) error { s.Desktop.IntroductionChat = &intake; return nil }); err != nil {
		t.Fatal(err)
	}
	memories, _ := memory.Open(state)
	if err := memories.SaveIntroduction(map[string]string{"profile.name": "Bob"}, intake.Revision); err != nil {
		t.Fatal(err)
	}
	response, _, err := confirmIntroduction(context.Background(), state, store, intake)
	if err != nil || !strings.Contains(response.Text, "saved details changed") {
		t.Fatal(response, err)
	}
	settings, _ = store.Load()
	if len(settings.Desktop.IntroductionChat.Proposal) != 0 || settings.Desktop.IntroductionChat.Revision == intake.Revision {
		t.Fatal("stale intake cannot recover")
	}
	records, _ := memories.List("", true)
	if len(records) != 1 || records[0].Text != "Bob" {
		t.Fatal("stale intake overwrote updated memory", records)
	}
}
