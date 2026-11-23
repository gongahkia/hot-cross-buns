package worksession

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
)

type primaryConversation struct {
	Version int    `json:"version"`
	ID      string `json:"conversation_id"`
}

// Primary returns the explicitly designated personal conversation. It never
// adopts the most recent topic or combines independent conversation histories.
// Removing a conversation also makes a dangling designation unavailable.
func (s Store) Primary() (string, error) {
	var value primaryConversation
	if err := readJSON(filepath.Join(s.root, "primary.json"), &value); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("read main conversation: %w", err)
	}
	if value.Version != 1 {
		return "", errors.New("main conversation designation is invalid")
	}
	if _, err := s.Load(value.ID); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("load main conversation: %w", err)
	}
	return value.ID, nil
}

// BindPrimary designates the first retained main conversation. A process lease
// prevents two newly opened windows from replacing each other's designation.
// The losing window keeps its independent topic and can open the existing main.
func (s Store) BindPrimary(id string) error {
	if _, err := s.Load(id); err != nil {
		return err
	}
	unlock, err := s.lockPrimary()
	if err != nil {
		return err
	}
	defer unlock()
	current, err := s.Primary()
	if err != nil {
		return err
	}
	if current != "" && current != id {
		return errors.New("another window saved the main conversation first; this conversation remains a separate topic")
	}
	return writeJSON(filepath.Join(s.root, "primary.json"), primaryConversation{Version: 1, ID: id})
}

// EnsurePrimary creates the main chat once, even before its first message.
// It neither adopts a recent topic nor resumes any retained operation.
func (s Store) EnsurePrimary(source string, now time.Time) (Conversation, error) {
	unlock, err := s.lockPrimary()
	if err != nil {
		return Conversation{}, err
	}
	defer unlock()
	id, err := s.Primary()
	if err != nil {
		return Conversation{}, err
	}
	if id != "" {
		return s.Load(id)
	}
	chat, err := s.create("Hot Cross Buns", source, "", now, true)
	if err != nil {
		return Conversation{}, err
	}
	if err := writeJSON(filepath.Join(s.root, "primary.json"), primaryConversation{Version: 1, ID: chat.ID}); err != nil {
		return Conversation{}, err
	}
	return chat, nil
}

func (s Store) lockPrimary() (func(), error) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	lock, err := filelock.OpenRootFile(root, ".primary-lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := filelock.Lock(lock, filelock.Exclusive); err != nil {
		lock.Close()
		return nil, err
	}
	return func() { filelock.Unlock(lock); lock.Close() }, nil
}
