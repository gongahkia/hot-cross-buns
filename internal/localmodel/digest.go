package localmodel

import (
	"context"
	"encoding/hex"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"strings"
)

// ModelDigest validates artifact metadata, never a credential fingerprint.
func ModelDigest(raw string) (string, error) {
	value := strings.TrimPrefix(strings.ToLower(raw), "sha256:")
	if len(value) != 64 {
		return "", errors.New("verified SHA-256 model digest unavailable")
	}
	if _, err := hex.DecodeString(value); err != nil {
		return "", errors.New("invalid model digest")
	}
	return value, nil
}

// DigestCheckedModel rechecks a captured binding before inference. Ollama still
// accepts a mutable tag, so this is not an atomic server-side digest pin.
type DigestCheckedModel struct {
	Backend     agent.Model
	Client      Client
	Tag, Digest string
}

func (m DigestCheckedModel) SupportsVisualInput() bool { return false }
func (m DigestCheckedModel) Complete(ctx context.Context, turn agent.TurnRequest) (agent.Turn, error) {
	inventory, err := m.Client.Models(ctx)
	if err != nil {
		return agent.Turn{}, errors.New("selected local model cannot be verified; refresh Models and Providers before retrying")
	}
	for _, item := range inventory {
		if item.Name == m.Tag {
			digest, e := ModelDigest(item.Digest)
			if e != nil || digest != m.Digest {
				return agent.Turn{}, errors.New("selected local model digest changed; review and select the installed identity again")
			}
			return m.Backend.Complete(ctx, turn)
		}
	}
	return agent.Turn{}, errors.New("selected local model is missing; restore it explicitly, then review selection; no fallback was used")
}
