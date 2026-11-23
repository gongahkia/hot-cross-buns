package worksession

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func historyRepairName(key string) string {
	return ".history-dirty-" + strings.ReplaceAll(key, ":", "-")
}

// A failed cache hook leaves a durable source identity for repair. The canonical
// write still succeeds; summaries are withheld until this small backlog clears.
func (s Store) historyHookResult(chat, key string, err error) {
	root, openErr := os.OpenRoot(filepath.Join(s.root, chat))
	if openErr != nil {
		return
	}
	defer root.Close()
	name := historyRepairName(key)
	if err == nil {
		_ = root.Remove(name)
		return
	}
	_ = writeCreationJSON(root, name, struct {
		Key string `json:"key"`
	}{key})
}

func (s Store) repairHistory(ctx context.Context, chat string) error {
	root, err := os.OpenRoot(filepath.Join(s.root, chat))
	if err != nil {
		return err
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(-1)
	dir.Close()
	if err != nil {
		return err
	}
	var pending []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".history-dirty-") {
			pending = append(pending, entry.Name())
		}
	}
	for _, name := range pending[:min(32, len(pending))] {
		key := strings.TrimPrefix(name, ".history-dirty-")
		if strings.HasPrefix(key, "dialogue-") {
			key = "dialogue:" + strings.TrimPrefix(key, "dialogue-")
		} else if strings.HasPrefix(key, "work-") {
			key = "work:" + strings.TrimPrefix(key, "work-")
		} else {
			return errors.New("invalid pending history identity")
		}
		if _, _, err := s.ReadHistoryTurn(ctx, chat, key); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := root.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if len(pending) > 32 {
		return errors.New("history repair backlog is still catching up")
	}
	return nil
}
