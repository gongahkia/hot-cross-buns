package config

import (
	"strings"
	"testing"
)

func TestLocalBindingsRemainOptionalValidatedAndPreservedByUpdate(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	initial := Default()
	initial.CustomProviders = []CustomProvider{{ID: "hot-cross-buns-local", BaseURL: "http://127.0.0.1:11434/v1/chat/completions", Models: []string{"qwen3:4b"}, DefaultModel: "qwen3:4b"}}
	if err := store.Save(initial); err != nil {
		t.Fatal("older tag-only configuration rejected", err)
	}
	initial.CustomProviders[0].ModelDigests = map[string]string{"qwen3:4b": strings.Repeat("a", 64)}
	if err := store.Save(initial); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(s *Settings) error { s.Theme = "mono"; return nil }); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil || loaded.CustomProviders[0].ModelDigests["qwen3:4b"] != strings.Repeat("a", 64) {
		t.Fatal("fresh update lost binding", err)
	}
	for _, bad := range []string{"unknown", strings.Repeat("z", 64), strings.Repeat("A", 64)} {
		initial.CustomProviders[0].ModelDigests["qwen3:4b"] = bad
		if err := store.Save(initial); err == nil {
			t.Fatal("invalid digest saved")
		}
	}
	initial.CustomProviders[0].ID = "custom-cloud"
	initial.CustomProviders[0].ModelDigests["qwen3:4b"] = strings.Repeat("a", 64)
	if err := store.Save(initial); err == nil {
		t.Fatal("local binding accepted for unrelated provider")
	}
}
