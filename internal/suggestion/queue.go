package suggestion

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

type QueueAction struct {
	RequestID string `json:"request_id"`
	Action    string `json:"action"`
	ID        string `json:"id,omitempty"`
	Revision  string `json:"revision,omitempty"`
}

type EvidenceCheck struct {
	Status     string   `json:"status"`
	Verified   []string `json:"verified,omitempty"`
	Unverified []string `json:"unverified,omitempty"`
	Note       string   `json:"note"`
}

type Review struct {
	Record
	Revision           string        `json:"revision"`
	ReferenceIntegrity EvidenceCheck `json:"reference_integrity"`
	CurrentNote        any           `json:"current_note,omitempty"`
	ConflictCheck      string        `json:"conflict_check,omitempty"`
}

type QueueResult struct {
	RequestID string   `json:"request_id"`
	Entries   []Record `json:"entries"`
	Review    *Review  `json:"review,omitempty"`
	Notice    string   `json:"notice,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// Revision binds a review decision to every retained field of the proposal.
func (r Record) Revision() string {
	data, _ := json.Marshal(r)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
