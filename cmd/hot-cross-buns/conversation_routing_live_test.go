package main

import (
	"context"
	"os"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestLiveRelatedTaskRouting(t *testing.T) {
	if os.Getenv("HOT_CROSS_BUNS_LIVE_ROUTING") != "1" {
		t.Skip("opt-in model-backed routing evaluation")
	}
	settings, err := loadSettings()
	if err != nil {
		t.Fatal(err)
	}
	provider, name, err := resolveConfiguredProvider(settings.Defaults.Provider, settings.Defaults.Model)
	if err != nil {
		t.Fatal(err)
	}
	backend, err := nativeWorkModel(provider, name, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ title, summary, message, want string }{
		{"2025 Iran war", "Researched the June 2025 war, its chronology and ceasefire.", "What about US intervention in that war?", "continue"},
		{"Tokyo trip", "Compared accommodation and transport for a five-day Tokyo trip.", "Can you look into hotels near Shinjuku for that trip too?", "continue"},
		{"2025 Iran war", "Researched the June 2025 war.", "Find my local Dockerfiles.", "work"},
		{"Preferences", "", "I prefer casual, concise replies. Please remember that.", "work"},
		{"Research", "", "Research local-first personal assistants thoroughly, compare their capabilities and write a detailed report with sources.", "task"},
	} {
		t.Run(tc.title+tc.want, func(t *testing.T) {
			request := workrun.ConversationRequest{Text: tc.message, CanStart: true, CanWork: true, LearnFromChats: true, Recent: []workrun.ConversationMessage{{Role: "user", Text: "Please research " + tc.title}, {Role: "assistant", Text: tc.summary}}, Tasks: []workrun.ConversationTask{{ID: "research-task", Title: tc.title, State: "completed", Summary: tc.summary, CanContinue: true}}}
			if tc.summary == "" {
				request.Recent = nil
				request.Tasks = nil
			}
			decision, err := workrun.RouteConversation(context.Background(), backend, request)
			if err != nil {
				t.Fatal(err)
			}
			if decision.Kind != tc.want || tc.want == "continue" && decision.Target != "research-task" {
				t.Fatalf("expected %s: %+v", tc.want, decision)
			}
		})
	}
	t.Run("ambiguous", func(t *testing.T) {
		request := workrun.ConversationRequest{Text: "Can you expand that research?", CanStart: true, Recent: []workrun.ConversationMessage{{Role: "assistant", Text: "Your Iran-war report and Tokyo accommodation comparison are both ready."}}, Tasks: []workrun.ConversationTask{{ID: "iran", Title: "2025 Iran war", State: "completed", CanContinue: true}, {ID: "tokyo", Title: "Tokyo trip", State: "completed", CanContinue: true}}}
		decision, err := workrun.RouteConversation(context.Background(), backend, request)
		if err != nil {
			t.Fatal(err)
		}
		if decision.Kind != "clarify" {
			t.Fatalf("ambiguous followup should clarify: %+v", decision)
		}
	})

}
