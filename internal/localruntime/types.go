// Package localruntime owns a separate Ollama process, private model storage,
// reviewed lifecycle operations and the pinned proxy used by cooperating tasks.
package localruntime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
)

type Action struct {
	RequestID  string `json:"request_id"`
	Action     string `json:"action"`
	ReviewID   string `json:"review_id,omitempty"`
	Generation string `json:"generation,omitempty"`
	ModelID    string `json:"model_id,omitempty"`
}
type Review struct {
	ID           string    `json:"id"`
	Generation   string    `json:"generation"`
	Action       string    `json:"action"`
	Binary       string    `json:"binary,omitempty"`
	BinaryDigest string    `json:"binary_digest,omitempty"`
	Storage      string    `json:"storage,omitempty"`
	ModelID      string    `json:"model_id,omitempty"`
	Tag          string    `json:"tag,omitempty"`
	Size         string    `json:"size,omitempty"`
	Notice       string    `json:"notice"`
	Expires      time.Time `json:"expires"`
}
type Receipt struct {
	ID        string    `json:"id"`
	RequestID string    `json:"request_id"`
	Action    string    `json:"action"`
	ModelID   string    `json:"model_id,omitempty"`
	Tag       string    `json:"tag,omitempty"`
	Phase     string    `json:"phase"`
	Progress  string    `json:"progress,omitempty"`
	Completed int64     `json:"completed,omitempty"`
	Total     int64     `json:"total,omitempty"`
	Issue     string    `json:"issue,omitempty"`
	Updated   time.Time `json:"updated"`
}
type Status struct {
	Generation string   `json:"generation"`
	State      string   `json:"state"`
	Endpoint   string   `json:"endpoint,omitempty"`
	Binary     string   `json:"binary,omitempty"`
	Storage    string   `json:"storage,omitempty"`
	Active     int      `json:"active"`
	Available  bool     `json:"available"`
	Issue      string   `json:"issue,omitempty"`
	Receipt    *Receipt `json:"receipt,omitempty"`
}
type Result struct {
	Status    Status  `json:"status"`
	Review    *Review `json:"review,omitempty"`
	Confirmed bool    `json:"confirmed"`
	Error     string  `json:"error,omitempty"`
}
type Config struct {
	StateDir   string
	ModelsDir  string
	Executable string
	// Tests supply an inert host and listener check; production uses OS facts.
	Host   func() localmodel.Host
	Verify func(pid int, binary, address string) error
}

func nonce() string {
	var value [24]byte
	if _, err := io.ReadFull(rand.Reader, value[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(value[:])
}
func timeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 8*time.Second)
}
