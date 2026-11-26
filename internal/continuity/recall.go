package continuity

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"unicode"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func terms(query string) []string {
	var result []string
	stop := " a an the what when where who why how was were is are am i me my you your we our it its this that these those do did does about please remember recall tell said earlier before again and or to of in for with from can could would should have has had "
	for _, word := range strings.FieldsFunc(strings.ToLower(query), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) && !unicode.IsMark(r) }) {
		if strings.Contains(stop, " "+word+" ") || len([]rune(word)) < 2 {
			continue
		}
		result = append(result, word)
		if len(result) == 24 {
			break
		}
	}
	return result
}

func recall(ctx context.Context, stateDir string, sessions worksession.Store, memories memory.Store, model agent.Model, options Options, notices *[]string) ([]Recall, error) {
	budget := budgetFor(model, options.Query, options.ReservedTokens)
	remaining := budget.recall
	words := terms(options.Query)
	if len(words) == 0 {
		return nil, nil
	}
	goals, err := goal.Open(stateDir)
	if err != nil {
		return nil, err
	}
	records, err := goals.List()
	if err != nil {
		return nil, err
	}
	denied := map[string]bool{}
	for _, g := range records {
		if g.ID != options.GoalID && g.ConversationID != "" {
			denied[g.ConversationID] = true
		}
	}
	candidates, err := sessions.SearchHistory(ctx, words, 64)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		*notices = append(*notices, "Indexed archive recall is unavailable; this reply uses recent messages and current memory.")
		return nil, nil
	}
	// Eligibility is also checked BEFORE embedding, so disallowed source text
	// cannot be sent to a local or cloud embedding endpoint.
	eligibility := func(m worksession.HistoryMatch) (bool, error) {
		if m.Chat != options.ConversationID && !options.ReferToChats || denied[m.Chat] {
			return false, nil
		}
		allowed, err := historyScope(sessions, m.Chat, denied)
		if err != nil || !allowed {
			return false, nil
		}
		if m.Chat != options.ConversationID {
			blocked, err := memories.HistorySuppressed(m.Chat, options.GoalID)
			if err != nil {
				return false, err
			}
			if blocked {
				if err := sessions.DropHistoryVectors(ctx, m.Chat, ""); err != nil {
					return false, err
				}
				return false, nil
			}
		}
		q := worksession.HistoryQuery{Chat: m.Chat, At: options.BeforeTime}
		if m.Chat == options.ConversationID {
			q.Before = options.BeforeSequence
		}
		return sessions.HistoryMatchEligible(ctx, q, m)
	}
	if options.Embedder != nil {
		semantic, err := semanticHistory(ctx, sessions, memories, model, options, eligibility)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			*notices = append(*notices, "Semantic archive recall is unavailable; exact-word search remains active.")
		} else {
			candidates = fuseHistory(candidates, semantic)
			*notices = append(*notices, "Archive recall combines exact words and available semantic matches. Embeddings catch up in bounded pages; recall is selective, not exhaustive.")
		}
	}
	var result []Recall
	seen := map[string]bool{}
	for _, m := range candidates {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		allowed, err := eligibility(m)
		if err != nil || !allowed {
			continue
		}
		t, err := sessions.ReadHistoryMatch(ctx, m)
		if err != nil {
			continue
		}
		key := m.Chat + ":" + m.Key
		if seen[key] {
			continue
		}
		seen[key] = true
		checked, err := screen(ctx, memories, model, options.GoalID, []worksession.ContextTurn{t})
		if err != nil {
			return nil, err
		}
		if len(checked) > 0 {
			item := Recall{m.Chat, checked[0]}
			if budget.adaptive {
				data, _ := json.Marshal(item)
				cost := budget.profile.Count(string(data))
				if cost > remaining {
					continue
				}
				remaining -= cost
			}
			result = append(result, item)
		}
		if (len(result) == 4 && !budget.adaptive) || len(result) >= 16 {
			break
		}
	}
	return result, nil
}

func historyScope(sessions worksession.Store, id string, denied map[string]bool) (bool, error) {
	seen := map[string]bool{}
	for depth := 0; id != "" && depth < 16; depth++ {
		if denied[id] || seen[id] {
			return false, nil
		}
		seen[id] = true
		origin, err := sessions.DialogueTask(id)
		if err != nil {
			return false, err
		}
		if origin != nil {
			id = origin.ParentConversationID
			continue
		}
		branch, err := sessions.Branch(id)
		if err != nil {
			return false, err
		}
		if branch != nil {
			id = branch.ParentConversationID
			continue
		}
		return true, nil
	}
	return false, nil
}

func commitments(stateDir string, options Options) ([]Commitment, error) {
	store, err := goal.Open(stateDir)
	if err != nil {
		return nil, err
	}
	records, err := store.List()
	if err != nil {
		return nil, err
	}
	var result []Commitment
	for _, record := range records {
		if record.Status != goal.Active || !options.Main && record.ID != options.GoalID {
			continue
		}
		plan, err := store.LoadPlan(record.ID)
		if err != nil {
			return nil, err
		}
		item := Commitment{GoalID: record.ID, Title: Clip(record.Title, 256), Context: Clip(record.Context, 768), PlanRevision: plan.Revision}
		for _, step := range plan.Steps {
			if step.Status != goal.StepDone {
				item.Steps = append(item.Steps, goal.Step{ID: step.ID, Title: Clip(step.Title, 256), Status: step.Status, DueAt: step.DueAt, StartsAt: step.StartsAt, EndsAt: step.EndsAt, DependsOn: step.DependsOn[:min(8, len(step.DependsOn))], UpdatedAt: step.UpdatedAt})
			}
			if len(item.Steps) == 4 {
				break
			}
		}
		result = append(result, item)
		if len(result) == 6 {
			break
		}
	}
	return result, nil
}

type Task struct {
	ConversationID  string `json:"conversation_id"`
	RequestID       string `json:"request_id"`
	Title           string `json:"title"`
	RecordedState   string `json:"recorded_state"`
	NeedsInspection bool   `json:"needs_inspection"`
}

func taskRecords(sessions worksession.Store, current string, turns []worksession.ContextTurn) ([]Task, []Report, error) {
	ids := []string{current}
	seen := map[string]bool{current: true}
	for i := len(turns) - 1; i >= 0 && len(ids) < 9; i-- {
		id := turns[i].TaskChat
		if id != "" && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	var result []Task
	type outcome struct {
		chat    string
		request worksession.Request
	}
	var outcomes []outcome
	for _, id := range ids {
		journal, err := sessions.LoadRequests(id)
		if errors.Is(err, os.ErrNotExist) {
			result = append(result, Task{ConversationID: id, RecordedState: "owner_unavailable", NeedsInspection: true})
			continue
		}
		if err != nil {
			return nil, nil, err
		}
		for _, r := range journal.Requests {
			if len(result) < 12 && (r.Pending() || r.AwaitingRecovery()) {
				result = append(result, Task{ConversationID: id, RequestID: r.ID, Title: Clip(r.Text, 512), RecordedState: r.State, NeedsInspection: true})
			}
			if r.State == "completed" || r.State == "failed" || r.State == "stopped" {
				outcomes = append(outcomes, outcome{id, r})
			}
		}
	}
	sort.SliceStable(outcomes, func(i, j int) bool { return outcomes[i].request.UpdatedAt.After(outcomes[j].request.UpdatedAt) })
	var reports []Report
	for _, o := range outcomes[:min(4, len(outcomes))] {
		r := o.request
		report := Report{ID: r.ID, ConversationID: o.chat, Title: Clip(r.Text, 256), State: r.State, UpdatedAt: r.UpdatedAt, Summary: "Retained output is unavailable; inspect the owning task before relying on an outcome."}
		if r.RevisionID != "" {
			revision, err := sessions.LoadRevision(o.chat, r.RevisionID)
			if err == nil {
				report.Summary = Clip(revision.FinalText, 2048)
			}
		}
		reports = append(reports, report)
	}
	return result, reports, nil
}

type Schedule struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Cron               string `json:"cron"`
	Timezone           string `json:"timezone"`
	RequiresOnlineHost bool   `json:"requires_online_host"`
}

func schedules(stateDir string, options Options) ([]Schedule, error) {
	store, err := jobs.Open(stateDir)
	if err != nil {
		return nil, err
	}
	definitions, err := store.List()
	if err != nil {
		return nil, err
	}
	var result []Schedule
	for _, d := range definitions {
		if !d.Enabled || !options.Main && (options.GoalID == "" || d.GoalID != options.GoalID) {
			continue
		}
		result = append(result, Schedule{d.ID, Clip(d.Name, 256), d.Schedule, d.Timezone, true})
		if len(result) == 6 {
			break
		}
	}
	return result, nil
}

func screenReferences(ctx context.Context, memories memory.Store, model agent.Model, scope string, result *Context) error {
	allowed := func(id string, value any) (bool, error) {
		data, err := json.Marshal(value)
		if err != nil {
			return false, err
		}
		if len(data) > 8*1024 {
			return false, errors.New("retained commitment exceeds its complete privacy-comparison bound")
		}
		checked, err := screen(ctx, memories, model, scope, []worksession.ContextTurn{{ID: id, User: string(data)}})
		return len(checked) > 0, err
	}
	goals := result.Commitments[:0]
	for _, item := range result.Commitments {
		ok, err := allowed("goal:"+item.GoalID, item)
		if err != nil {
			return err
		}
		if ok {
			goals = append(goals, item)
		}
	}
	result.Commitments = goals
	tasks := result.Tasks[:0]
	for _, item := range result.Tasks {
		ok, err := allowed("task:"+item.ConversationID+":"+item.RequestID, item)
		if err != nil {
			return err
		}
		if ok {
			tasks = append(tasks, item)
		}
	}
	result.Tasks = tasks
	jobs := result.Schedules[:0]
	for _, item := range result.Schedules {
		ok, err := allowed("schedule:"+item.ID, item)
		if err != nil {
			return err
		}
		if ok {
			jobs = append(jobs, item)
		}
	}
	result.Schedules = jobs
	reports := result.Reports[:0]
	for _, item := range result.Reports {
		ok, err := allowed("report:"+item.ID, item)
		if err != nil {
			return err
		}
		if ok {
			reports = append(reports, item)
		}
	}
	result.Reports = reports
	results := result.Results[:0]
	for _, item := range result.Results {
		ok, err := allowed("result:"+item.ConversationID+":"+item.ID, item)
		if err != nil {
			return err
		}
		if ok {
			results = append(results, item)
		}
	}
	result.Results = results
	return nil
}
