package workapp

import (
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
	"regexp"

	tea "github.com/charmbracelet/bubbletea"
)

type BranchAction struct {
	TurnID         string `json:"turn_id,omitempty"`
	TurnRevision   uint64 `json:"turn_revision,omitempty"`
	ConversationID string `json:"conversation_id"`
	RevisionID     string `json:"revision_id,omitempty"`
	RunID          string `json:"run_id,omitempty"`
	RequestID      string `json:"request_id"`
}
type BranchResult struct {
	RequestID      string `json:"request_id"`
	ConversationID string `json:"conversation_id,omitempty"`
	Error          string `json:"error,omitempty"`
}
type BranchLink struct {
	ConversationID string `json:"conversation_id"`
	RevisionID     string `json:"revision_id"`
}

var branchIdentity = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$`)
var branchRequestIdentity = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{15,63}$`)

// BranchConversation changes navigation only after durable creation. It never
// moves the parent head or transfers its worker/approvals into the new chat.
func (m Model) BranchConversation(a BranchAction) (tea.Model, tea.Cmd) {
	m.branchResult = &BranchResult{RequestID: a.RequestID}
	fail := func(text string) (tea.Model, tea.Cmd) {
		m.branchResult.Error = text
		m.bridgeNotice = text
		return m, nil
	}
	if !branchRequestIdentity.MatchString(a.RequestID) || !branchIdentity.MatchString(a.ConversationID) || (a.TurnID == "" && (!branchIdentity.MatchString(a.RevisionID) || !branchIdentity.MatchString(a.RunID))) || (a.TurnID != "" && (!branchIdentity.MatchString(a.TurnID) || a.TurnRevision == 0 || a.RevisionID != "" || a.RunID != "")) || a.ConversationID != m.conversation {
		return fail("This branch belongs to another conversation or has an invalid boundary.")
	}
	if m.background || m.section != "" || m.launcher || m.models != nil || m.controlBusy || m.followupSaving || m.recallBusy || m.bridgeExternal != nil || m.pendingBundleAction != nil || m.receiptBusy || m.catalogSaving != 0 || m.running && !m.config.ManagedSessions {
		return fail("Return to the conversation and finish the current local operation before branching.")
	}
	eligible := false
	for _, message := range m.messages {
		if message.role == "Hot Cross Buns" && message.result == nil && message.revisionID == a.RevisionID && message.runID == a.RunID && message.text != "" {
			eligible = true
			break
		}
	}
	if a.TurnID != "" {
		eligible = false
		for _, turn := range m.dialogueTurns {
			if turn.ID == a.TurnID && turn.Revision == a.TurnRevision && (turn.State == "answered" || turn.State == "clarification") && turn.Response != "" && turn.Issue == "" {
				eligible = true
				break
			}
		}
	}
	if !eligible || (a.TurnID == "" && m.config.ForkConversation == nil) || (a.TurnID != "" && m.config.ForkDialogueConversation == nil) {
		return fail("Only completed, retained answers in this conversation can be branched.")
	}
	var c worksession.Conversation
	var err error
	if a.TurnID != "" {
		c, err = m.config.ForkDialogueConversation(a.ConversationID, a.TurnID, a.TurnRevision, a.RequestID)
	} else {
		c, err = m.config.ForkConversation(a.ConversationID, a.RevisionID, a.RunID, a.RequestID)
	}
	if err != nil {
		return fail("Could not create the branch: " + err.Error())
	}
	m.branchResult.ConversationID = c.ID
	m.refreshBridgeConversations()
	if m.config.ManagedSessions {
		m.requestSession(BridgeSessionRequest{ConversationID: c.ID})
	} else {
		m.restoreConversation(c.ID, "")
	}
	return m, nil
}
