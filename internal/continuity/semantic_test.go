package continuity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

type meaningEmbedder struct {
	inputs []string
	fail   bool
}

func (*meaningEmbedder) ID() string { return "test/meaning-v1" }
func (e *meaningEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	e.inputs = append(e.inputs, texts...)
	if e.fail {
		return nil, errors.New("offline embedder")
	}
	var vectors [][]float32
	for _, text := range texts {
		v := make([]float32, 16)
		v[1] = 1
		if strings.Contains(text, "kiln") || strings.Contains(text, "pottery") {
			v[1] = 0
			v[0] = 1
		}
		vectors = append(vectors, v)
	}
	return vectors, nil
}

func TestHybridRecallFindsMeaningAndHonorsScopeBeforeEmbedding(t *testing.T) {
	root, s, main := fixture(t, 0)
	old, _ := s.CreateChat(t.TempDir(), time.Now())
	seed(t, s, old.ID, 0, 1, "The kiln is reserved for Saturday.")
	goals, _ := goal.Open(root)
	private, _ := goals.Add("Private plan", "", t.TempDir())
	hidden, _ := s.CreateChat(t.TempDir(), time.Now())
	if _, err := goals.AttachConversation(private.ID, hidden.ID); err != nil {
		t.Fatal(err)
	}
	seed(t, s, hidden.ID, 0, 1, "SECRET-PLAN pottery lesson")
	model := &testModel{}
	e := &meaningEmbedder{}
	options := Options{ConversationID: main.ID, Query: "pottery weekend", Main: true, ReferToChats: true, Embedder: e}
	result, err := Build(context.Background(), root, model, options)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Recalled) != 1 || !strings.Contains(result.Recalled[0].Turn.User, "kiln") {
		t.Fatal("semantic-only match was not recalled", result.Recalled, result.Notices)
	}
	if strings.Contains(strings.Join(e.inputs, "\n"), "SECRET-PLAN") {
		t.Fatal("goal-owned source was uploaded before eligibility")
	}
	// Persisted vectors survive reopening without re-embedding unchanged sources.
	e.inputs = nil
	if _, err := Build(context.Background(), root, model, options); err != nil {
		t.Fatal(err)
	}
	if len(e.inputs) != 1 || e.inputs[0] != "pottery weekend" {
		t.Fatal("restart rebuilt unchanged vectors", e.inputs)
	}
	e.inputs = nil
	options.ReferToChats = false
	result, err = Build(context.Background(), root, model, options)
	if err != nil || len(result.Recalled) != 0 {
		t.Fatal(result.Recalled, err)
	}
	if len(e.inputs) != 1 {
		t.Fatal("opted-out chat text was embedded", e.inputs)
	}
	// Canonical deletion invalidates selected semantic candidates, including vectors.
	matches, _ := s.SearchHistory(context.Background(), []string{"kiln"}, 8)
	if len(matches) != 1 {
		t.Fatal(matches)
	}
	// An admission before the old record's timestamp must exclude it before upload.
	options.ReferToChats = true
	options.BeforeTime = time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	e.inputs = nil
	result, err = Build(context.Background(), root, model, options)
	if err != nil || len(result.Recalled) != 0 {
		t.Fatal("future record leaked into admitted context", result.Recalled, err)
	}
}

func TestHybridFailureFallsBackToLexicalAndWithdrawalsStayWithheld(t *testing.T) {
	root, s, main := fixture(t, 0)
	other, _ := s.CreateChat(t.TempDir(), time.Now())
	seed(t, s, other.ID, 0, 1, "A private kiln preference")
	e := &meaningEmbedder{fail: true}
	model := &testModel{}
	options := Options{ConversationID: main.ID, ReferToChats: true, Query: "kiln preference", Embedder: e}
	result, err := Build(context.Background(), root, model, options)
	if err != nil || len(result.Recalled) != 1 || !strings.Contains(strings.Join(result.Notices, " "), "exact-word") {
		t.Fatal("semantic outage blocked lexical recall", result, err)
	}
	memories, _ := memory.Open(root)
	r, err := memories.RememberChat(memory.ChatInput{Subject: "preference.pottery", Kind: "preference", Quote: "A private kiln preference", ConversationID: other.ID, RunID: "source-run"})
	if err != nil {
		t.Fatal(err)
	}
	e.fail = false
	if _, err := Build(context.Background(), root, model, options); err != nil {
		t.Fatal(err)
	}
	if err := memories.Forget(r.ID); err != nil {
		t.Fatal(err)
	}
	e.inputs = nil
	model.block = "kiln"
	result, err = Build(context.Background(), root, model, options)
	if err != nil || len(result.Recalled) != 0 {
		t.Fatal("forgotten source resurfaced", result.Recalled, err)
	}
	for _, text := range e.inputs[:max(0, len(e.inputs)-1)] {
		if strings.Contains(text, "kiln") {
			t.Fatal("forgotten source uploaded", e.inputs)
		}
	}
}

func TestLargeArchivePreparationDoesNotDependOnLegacyScan(t *testing.T) {
	root, s, chat := fixture(t, 0)
	// The original in-memory scanner rejects this byte size. Indexed preparation
	// must retain recent detail and continue without scanning the archive wholesale.
	for i := 0; i < 140; i++ {
		text := strings.Repeat("broad archive detail ", 6000)
		r, err := s.AdmitDialogue(chat.ID, fmt.Sprintf("large-archive-message-%06d", i), text, json.RawMessage(`{}`), time.Now().Add(-time.Duration(150-i)*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if r.ID == "" {
			t.Fatal("missing source")
		}
	}
	result, err := Build(context.Background(), root, &testModel{}, Options{ConversationID: chat.ID, Query: "new question"})
	if err != nil || len(result.Recent) == 0 {
		t.Fatal("large canonical history blocked preparation", result.Notices, err)
	}
}

var _ agent.Model = (*testModel)(nil)

func TestUnavailableArchiveCacheLeavesRecentMessagesUsable(t *testing.T) {
	root, s, chat := fixture(t, 2)
	// The private-cache check rejects symlinks without touching their target.
	cache := filepath.Join(root, "hot-cross-buns", "cache")
	if err := os.RemoveAll(cache); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, cache); err != nil {
		t.Fatal(err)
	}
	result, err := Build(context.Background(), root, &testModel{}, Options{ConversationID: chat.ID, Query: "new thought"})
	if err != nil || len(result.Recent) != 4 || len(result.Notices) == 0 {
		t.Fatal("cache failure rejected canonical context", result, err)
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatal("cache symlink was followed", entries, err)
	}
	_ = s
}
