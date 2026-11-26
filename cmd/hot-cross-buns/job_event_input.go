package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

// jobEventInput is a private application protocol; payloads use stdin, not argv.
func jobEventInput(args []string, out io.Writer) error {
	if len(args) != 0 {
		return errors.New("event input accepts a JSON request on stdin")
	}
	var request struct {
		JobID    string          `json:"job_id"`
		Policy   string          `json:"policy"`
		Delivery string          `json:"delivery"`
		Type     string          `json:"type"`
		Data     json.RawMessage `json:"data"`
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 20*1024+1))
	if err != nil {
		return err
	}
	if len(raw) > 20*1024 {
		return errors.New("event request exceeds its limit")
	}
	if err := json.Unmarshal(raw, &request); err != nil {
		return errors.New("invalid event request")
	}
	store, _, err := jobStore()
	if err != nil {
		return err
	}
	queued, err := store.EnqueueEvent(request.JobID, request.Policy, request.Delivery, request.Type, request.Data, time.Now())
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"queued": queued, "duplicate": !queued})
}
