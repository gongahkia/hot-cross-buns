package worksession

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

// Context usage stores numeric telemetry only. It never retains request content.
func (s Store) SaveContextUsage(id string, value agent.ContextUsage) error {
	if _, err := s.Load(id); err != nil {
		return err
	}
	if !validContextUsage(value) {
		return errors.New("invalid context measurement")
	}
	root, err := workspace.Open(filepath.Join(s.root, id))
	if err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return root.WriteRegularFileAtomic("context-meter.json", data, 8192)
}
func (s Store) ReadContextUsage(id string) (*agent.ContextUsage, error) {
	if _, err := s.Load(id); err != nil {
		return nil, err
	}
	root, err := workspace.Open(filepath.Join(s.root, id))
	if err != nil {
		return nil, err
	}
	data, err := root.ReadRegularFile("context-meter.json", 8192)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value agent.ContextUsage
	if json.Unmarshal(data, &value) != nil || !validContextUsage(value) {
		return nil, errors.New("invalid saved context measurement")
	}
	return &value, nil
}
func validContextUsage(v agent.ContextUsage) bool {
	return v.Policy.Provider != "" && len(v.Policy.Provider) <= 128 && v.Policy.Model != "" && len(v.Policy.Model) <= 256 && v.Policy.Window >= 1024 && v.Policy.Window <= 4194304 && v.InputTokens >= 0 && v.InputLimit > 0 && v.InputLimit <= v.Policy.Window && v.InputTokens <= v.InputLimit && v.OutputReserve > 0 && v.OutputReserve <= v.Policy.Window/2 && !v.At.IsZero()
}
