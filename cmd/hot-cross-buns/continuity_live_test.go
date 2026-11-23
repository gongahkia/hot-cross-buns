package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/continuity"
	sharedusage "github.com/gongahkia/hot-cross-buns/internal/usage"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestLiveConversationContinuity(t *testing.T) {
	if os.Getenv("HOT_CROSS_BUNS_LIVE_CONTINUITY") != "1" {
		t.Skip("opt-in provider-backed continuity check")
	}
	settings, err := loadSettings()
	if err != nil {
		t.Fatal(err)
	}
	provider, name, err := resolveConfiguredProvider(settings.Defaults.Provider, settings.Defaults.Model)
	if err != nil {
		t.Fatal(err)
	}
	model, err := nativeWorkModel(provider, name, "")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	sessions, err := worksession.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := sessions.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 24; i++ {
		text := fmt.Sprintf("A passing observation about the weather, number %d.", i)
		if i == 0 {
			text = "I am Mira. For our synthetic SaffronHarbor trip, the decision deadline is 2027-02-12. We are comparing options only; no booking has been made or authorized."
		}
		if i == 1 {
			text = "Correction: the SaffronHarbor deadline is 2027-02-14. Keep this as a draft comparison; do not make a booking."
		}
		turn, err := sessions.AdmitDialogue(chat.ID, fmt.Sprintf("live-continuity-message-%04d", i), text, json.RawMessage(`{}`), time.Now().Add(time.Duration(i-30)*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = sessions.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State, turn.Response, turn.Decision = "answered", "Noted for this conversation.", json.RawMessage(`{"kind":"reply","text":"Noted for this conversation."}`)
		if _, err = sessions.UpdateDialogue(turn, turn.Revision); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	ctx = sharedusage.WithState(sharedusage.WithCategory(ctx, "retrieval"), root)
	prepared, err := continuity.Build(ctx, root, model, continuity.Options{ConversationID: chat.ID, Main: true})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Covered != 16 || prepared.Summary == "" {
		t.Fatal("older synthetic context was not summarized", prepared.Notices)
	}
	request := workrun.ConversationRequest{Text: "For SaffronHarbor, what is the corrected deadline and is a booking confirmed? Include the date as YYYY-MM-DD. Use the provided conversation only.", CanStart: false}
	for _, m := range prepared.Recent {
		request.Recent = append(request.Recent, workrun.ConversationMessage{Role: m.Role, Text: m.Text})
	}
	prepared.Recent = nil
	data, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	request.Continuity = string(data)
	decision, err := workrun.RouteConversation(ctx, model, request)
	if err != nil {
		t.Fatal(err)
	}
	answer := strings.ToLower(decision.Text)
	if decision.Kind != "reply" || !strings.Contains(answer, "2027-02-14") || strings.Contains(answer, "2027-02-12") {
		t.Fatalf("corrected date did not survive compaction: %q", decision.Text)
	}
	negative := strings.Contains(answer, "not confirmed") || strings.Contains(answer, "not been") || strings.Contains(answer, "no booking") || strings.Contains(answer, "not made") || strings.Contains(answer, "not booked") || strings.Contains(answer, "unconfirmed") || strings.Contains(answer, "not authorized")
	if !negative {
		t.Fatalf("draft/booking distinction was not explicit: %q", decision.Text)
	}
	t.Logf("Live continuity passed using %s/%s: a correction and unconfirmed booking survived 16 summarized turns. This is one synthetic case, not longitudinal quality evidence.", provider, name)
}
