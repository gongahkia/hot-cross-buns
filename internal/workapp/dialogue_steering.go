package workapp

import "github.com/gongahkia/hot-cross-buns/internal/workrun"

// The shortcut selects intent only. finishConversationRoute and the execution
// owner still recheck the exact live operation before accepting guidance.
func preferredSteering(request workrun.ConversationRequest, input ConversationInput, foreground string) (workrun.ConversationDecision, bool) {
	if !input.PreferSteering || request.HasFiles || request.PlanFirst {
		return workrun.ConversationDecision{}, false
	}
	active := func(task workrun.ConversationTask) bool {
		return task.State == "running" || task.State == "queued" || task.State == "review" || task.State == "waiting for review" || task.State == "preparing a plan" || task.State == "preparing a revised plan" || task.State == "plan awaiting review" || task.State == "reviewed plan awaiting dispatch" || task.State == "stopping" || task.CanGuide || task.CanStop || task.CanRevisePlan || task.CanCorrectAction
	}
	captured := map[string]bool{}
	for _, task := range input.TaskContext {
		if active(task) {
			captured[task.ID] = true
		}
	}
	if len(captured) == 0 {
		return workrun.ConversationDecision{}, false
	}
	var targets []workrun.ConversationTask
	for _, task := range request.Tasks {
		if captured[task.ID] && active(task) {
			targets = append(targets, task)
		}
	}
	for _, task := range targets {
		if task.ID == foreground || task.ID == request.ReplyToTaskID {
			targets = []workrun.ConversationTask{task}
			break
		}
	}
	if len(targets) == 1 && targets[0].CanGuide {
		if len(request.Text) > 64*1024 {
			return workrun.ConversationDecision{Kind: "clarify", Text: "Shorten this steering message to 64 KiB before sending it to the running task."}, true
		}
		return workrun.ConversationDecision{Kind: "guide", Target: targets[0].ID, Instruction: request.Text}, true
	}
	text := "That task has finished or changed. Send a new request after checking its result."
	if len(targets) > 1 {
		text = "Which running task should I steer? Open that task or reply to its task update so I can apply your instruction to the right work."
	} else if len(targets) == 1 {
		text = "This task cannot accept steering during its current preparation, approval or plan review. Use its review controls to request a correction, or stop it before starting different work."
	}
	return workrun.ConversationDecision{Kind: "clarify", Text: text}, true
}
