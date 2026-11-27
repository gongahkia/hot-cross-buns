package workapp

import (
	"encoding/json"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

// Inline work uses the main owner's existing execution lease, journal and queue.
// Persist intent before admission; an interrupted dispatch is never replayed.
func (m Model) startInlineDialogue(turn worksession.DialogueTurn) (tea.Model, tea.Cmd) {
	var input ConversationInput
	if json.Unmarshal(turn.Options, &input) != nil || input.Version != 1 || input.Source != m.source {
		return m.failConversation(turn, "The retained request scope is unavailable.")
	}
	if err := m.validateDialogueInputs(input); err != nil {
		return m.failConversation(turn, err.Error())
	}
	turn.State = "dispatching"
	turn, err := m.saveDialogue(turn)
	if err != nil {
		m.dialogueIssue = err.Error()
		return m.startConversationRoute()
	}
	options := retainedRunOptions(input.RunOptions)
	options.DialogueParent, options.DialogueTurn = m.conversation, turn.ID
	m.submissionID = turn.ID
	var cmd tea.Cmd
	userIndex := -1
	if m.running {
		m.queueSequence++
		queue := append(append([]queuedRun(nil), m.queue...), queuedRun{id: m.queueSequence, prompt: turn.Text, options: options})
		err = m.persistQueue(queue)
	} else {
		userIndex = len(m.messages)
		m.messages = append(m.messages, message{role: "You", text: turn.Text, createdAt: turn.CreatedAt, replyToUpdateID: options.ReplyToUpdateID})
		m.running, m.home = true, false
		m.status = "Working on your request…"
		next, run := m.startWork(m.source, m.conversation, turn.Text, options)
		m, cmd = next.(Model), run
	}
	m.submissionID = ""
	admitted := false
	for _, request := range m.requests.Requests {
		if request.ClientID == turn.ID {
			admitted = true
			break
		}
	}
	if err != nil || !admitted {
		if userIndex >= 0 && userIndex < len(m.messages) {
			// The durable failed dialogue remains the single user message.
			m.messages = append(m.messages[:userIndex], m.messages[userIndex+1:]...)
		}
		issue := m.bridgeNotice
		if err != nil {
			issue = err.Error()
		}
		return m.failConversation(turn, "Couldn't admit this request: "+issue)
	}
	// This acknowledges admission, not completion or permission for any action.
	turn.State, turn.Response = "guided", "Handling this here."
	if _, err := m.saveDialogue(turn); err != nil {
		m.dialogueIssue = err.Error()
	}
	next, route := m.startConversationRoute()
	return next, tea.Batch(cmd, route)
}

func (m Model) inlineDialogueVisibleInMessages(turnID string) bool {
	for _, request := range m.requests.Requests {
		if request.ClientID != turnID {
			continue
		}
		var options RunOptions
		if json.Unmarshal(request.Options, &options) != nil || options.DialogueParent != m.conversation || options.DialogueTurn != turnID {
			continue
		}
		for _, message := range m.messages {
			if message.role == "You" && (message.requestID == request.ID || request.RevisionID != "" && message.revisionID == request.RevisionID) {
				return true
			}
		}
	}
	return false
}
