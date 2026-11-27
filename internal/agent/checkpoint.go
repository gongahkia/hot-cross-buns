package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

var ErrCheckpoint = errors.New("checkpoint cannot be resumed safely")
var ErrPaused = errors.New("agent paused at a durable turn boundary")

const checkpointLimit = 16 * 1024 * 1024

// CheckpointConfig is host-only. Scope must cover resource identities, account
// pins, permissions, policy revisions and execution workspace. Resume is always
// explicit and requires the host to revalidate current authority and resources.
type CheckpointConfig struct {
	Directory  string
	ID         string
	Scope      string
	Resume     bool
	Revalidate func(context.Context, RunCheckpoint) error
	Sanitize   func([]Message) []Message
}
type RunCheckpoint struct {
	Version         int               `json:"version"`
	Binding         string            `json:"binding"`
	State           string            `json:"state"`
	NextStep        int               `json:"next_step"`
	Messages        []Message         `json:"messages"`
	Archived        []Message         `json:"archived,omitempty"`
	Summary         string            `json:"summary,omitempty"`
	ActiveTools     []ToolDefinition  `json:"active_tools"`
	FallbackApplied bool              `json:"fallback_applied"`
	PendingCall     *ToolCall         `json:"pending_call,omitempty"`
	Budget          *CheckpointBudget `json:"budget,omitempty"`
	Deadline        time.Time         `json:"deadline,omitempty"`
	MediaOmitted    bool              `json:"media_omitted,omitempty"`
}
type CheckpointBudget struct {
	Limits Limits `json:"limits"`
	Usage  Usage  `json:"usage"`
}
type checkpointSession struct {
	config  CheckpointConfig
	root    workspace.Root
	lock    *os.File
	path    string
	binding string
}

func openCheckpoint(config CheckpointConfig, binding string) (*checkpointSession, error) {
	if config.Directory == "" || config.ID == "" || config.Scope == "" {
		return nil, fmt.Errorf("%w: missing host scope", ErrCheckpoint)
	}
	if err := privatefs.MkdirAll(config.Directory); err != nil {
		return nil, err
	}
	info, err := os.Lstat(config.Directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrCheckpoint
	}
	root, err := workspace.Open(config.Directory)
	if err != nil {
		return nil, err
	}
	osRoot, err := os.OpenRoot(root.Path())
	if err != nil {
		return nil, err
	}
	defer osRoot.Close()
	name := checkpointHash([]byte(config.ID))
	lock, err := filelock.OpenRootFile(osRoot, name+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := filelock.Lock(lock, filelock.Exclusive|filelock.Nonblocking); err != nil {
		lock.Close()
		return nil, fmt.Errorf("%w: checkpoint already owned", ErrCheckpoint)
	}
	session := &checkpointSession{config: config, root: root, lock: lock, path: name + ".json", binding: binding}
	if !config.Resume {
		if _, err := osRoot.Lstat(session.path); !errors.Is(err, os.ErrNotExist) {
			session.close()
			return nil, fmt.Errorf("%w: checkpoint already exists", ErrCheckpoint)
		}
	}
	return session, nil
}
func (s *checkpointSession) close() { _ = filelock.Unlock(s.lock); _ = s.lock.Close() }
func checkpointHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func checkpointBinding(options RunOptions, definitions []ToolDefinition, model Model, steps int) string {
	ids := []string{}
	for _, rule := range options.Policies {
		ids = append(ids, rule.ID)
	}
	raw, _ := json.Marshal(struct {
		Task, System, Scope string
		Tools               []ToolDefinition
		Model               ContextPolicy
		MaxSteps            int
		InitialTools        []string
		MaxParallelReads    int
		Rules               []string
	}{options.Task, options.System, options.Checkpoint.Scope, definitions, ContextFor(model), steps, options.InitialTools, options.MaxParallelReads, ids})
	return checkpointHash(raw)
}
func (s *checkpointSession) save(ctx context.Context, snapshot RunCheckpoint) error {
	snapshot.Version = 1
	snapshot.Binding = s.binding
	snapshot.Messages = cloneMessages(snapshot.Messages)
	snapshot.Archived = cloneMessages(snapshot.Archived)
	// Visual bytes and opaque visual continuations are ephemeral. Text-only
	// checkpoints remain resumable; media workflows require fresh observation.
	for _, messages := range [][]Message{snapshot.Messages, snapshot.Archived} {
		for i := range messages {
			visual := len(messages[i].Images) > 0 || len(messages[i].Attachments) > 0 || messages[i].IsObservation
			for _, call := range messages[i].ToolCalls {
				visual = visual || call.Kind == ToolCallComputer
			}
			if visual {
				snapshot.MediaOmitted = true
				messages[i].Images = nil
				messages[i].Attachments = nil
				messages[i].ProviderData = nil
			}
		}
	}
	if s.config.Sanitize != nil {
		snapshot.Messages = s.config.Sanitize(snapshot.Messages)
		snapshot.Archived = s.config.Sanitize(snapshot.Archived)
	}
	if deadline, ok := ctx.Deadline(); ok {
		snapshot.Deadline = deadline
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	envelope, err := json.Marshal(struct {
		Checksum string          `json:"checksum"`
		Payload  json.RawMessage `json:"payload"`
	}{checkpointHash(raw), raw})
	if err != nil {
		return err
	}
	return s.root.WriteRegularFileAtomic(s.path, envelope, checkpointLimit)
}
func (s *checkpointSession) load(ctx context.Context, maxSteps int) (RunCheckpoint, error) {
	var envelope struct {
		Checksum string          `json:"checksum"`
		Payload  json.RawMessage `json:"payload"`
	}
	raw, err := s.root.ReadRegularFile(s.path, checkpointLimit)
	if err != nil {
		return RunCheckpoint{}, err
	}
	if json.Unmarshal(raw, &envelope) != nil || checkpointHash(envelope.Payload) != envelope.Checksum {
		return RunCheckpoint{}, ErrCheckpoint
	}
	var snapshot RunCheckpoint
	if json.Unmarshal(envelope.Payload, &snapshot) != nil || snapshot.Version != 1 || snapshot.Binding != s.binding || snapshot.State != "ready" || snapshot.NextStep < 1 || snapshot.NextStep > maxSteps || snapshot.PendingCall != nil || snapshot.MediaOmitted {
		return RunCheckpoint{}, ErrCheckpoint
	}
	if !snapshot.Deadline.IsZero() {
		deadline, ok := ctx.Deadline()
		if !ok || deadline.After(snapshot.Deadline) || time.Now().After(snapshot.Deadline) {
			return RunCheckpoint{}, fmt.Errorf("%w: original deadline exceeded or widened", ErrCheckpoint)
		}
	}
	if s.config.Revalidate == nil {
		return RunCheckpoint{}, fmt.Errorf("%w: host revalidation required", ErrCheckpoint)
	}
	if err := s.config.Revalidate(ctx, snapshot); err != nil {
		return RunCheckpoint{}, fmt.Errorf("%w: scope revalidation failed", ErrCheckpoint)
	}
	if err := ctx.Err(); err != nil {
		return RunCheckpoint{}, err
	}
	return snapshot, nil
}

// CheckpointPath is useful for private diagnostics, never a resume capability.
func CheckpointPath(directory, id string) string {
	return filepath.Join(directory, checkpointHash([]byte(id))+".json")
}

func checkpointBudget(model Model) *CheckpointBudget {
	if m, ok := model.(*budgetModel); ok {
		return &CheckpointBudget{Limits: m.budget.CurrentLimits(), Usage: m.budget.Usage()}
	}
	return nil
}
func restoreCheckpointBudget(model Model, snapshot *CheckpointBudget) error {
	current := checkpointBudget(model)
	if (current == nil) != (snapshot == nil) {
		return ErrCheckpoint
	}
	if current == nil {
		return nil
	}
	m := model.(*budgetModel)
	b := m.budget
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.Parent != nil || b.Limits != snapshot.Limits {
		return fmt.Errorf("%w: shared or changed budget", ErrCheckpoint)
	}
	if b.usage.ModelRequests != 0 {
		raw, _ := json.Marshal(b.usage)
		saved, _ := json.Marshal(snapshot.Usage)
		if string(raw) != string(saved) {
			return ErrCheckpoint
		}
		return nil
	}
	if snapshot.Usage.ModelRequests < 0 || snapshot.Usage.UnknownRequests < 0 || snapshot.Usage.InputTokens < 0 || snapshot.Usage.OutputTokens < 0 {
		return ErrCheckpoint
	}
	b.usage = snapshot.Usage
	return nil
}
