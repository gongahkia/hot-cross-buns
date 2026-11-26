package continuity

import (
	"encoding/json"
	"fmt"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

type contextBudget struct {
	profile                                      agent.ContextPolicy
	adaptive                                     bool
	total, recent, summary, memory, recall, scan int
}

func budgetFor(model agent.Model, query string, reserved ...int) contextBudget {
	p := agent.ContextFor(model)
	if _, ok := model.(agent.ContextModel); !ok {
		return contextBudget{p, false, 80 * 1024, 48 * 1024, 12 * 1024, 4096, 16 * 1024, 11}
	}
	overhead := p.InputLimit() / 2
	if len(reserved) > 0 && reserved[0] > 0 {
		overhead = reserved[0]
	}
	total := max(0, (p.InputLimit()-p.Count(query)-overhead)*3/4)
	return contextBudget{p, true, total, total * 45 / 100, total * 20 / 100, min(16384, total*15/100), total * 15 / 100, min(128, max(11, total/256))}
}

// fitContext accounts for JSON framing and keeps source objects whole when
// removing lower-priority evidence. It never changes a canonical source.
func fitContext(value *Context, b contextBudget) error {
	if !b.adaptive {
		return nil
	}
	size := func() int { data, _ := json.Marshal(value); return b.profile.Count(string(data)) }
	if size() <= b.total {
		return nil
	}
	value.Notices = append(value.Notices, "Prepared context reached the selected model budget; some historical evidence was omitted. Originals remain available.")
	for size() > b.total {
		switch {
		case len(value.Recalled) > 0:
			value.Recalled = value.Recalled[:len(value.Recalled)-1]
		case value.Summary != "":
			value.Summary = b.profile.Trim(value.Summary, b.profile.Count(value.Summary)/2)
			if b.profile.Count(value.Summary) < 128 {
				value.Summary = ""
			}
		case len(value.Recent) > 2:
			value.Recent = value.Recent[1:]
		case len(value.Results) > 0:
			value.Results = value.Results[:len(value.Results)-1]
		case len(value.Memories) > 0:
			id := value.Memories[len(value.Memories)-1].ID
			value.Memories = value.Memories[:len(value.Memories)-1]
			for i := range value.RecallTrace {
				if value.RecallTrace[i].ID == id {
					value.RecallTrace[i].Selected = false
					value.RecallTrace[i].Reason = "selected model context budget"
				}
			}
		case len(value.Reports) > 0:
			value.Reports = value.Reports[:len(value.Reports)-1]
		case len(value.Commitments) > 0:
			value.Commitments = value.Commitments[:len(value.Commitments)-1]
		case len(value.Tasks) > 0:
			value.Tasks = value.Tasks[:len(value.Tasks)-1]
		case len(value.Schedules) > 0:
			value.Schedules = value.Schedules[:len(value.Schedules)-1]
		case len(value.Recent) > 0:
			value.Recent = value.Recent[1:]
		case len(value.RecallTrace) > 0:
			value.RecallTrace = nil
		default:
			return fmt.Errorf("selected model leaves too little context for conversation metadata; shorten the message or configure a larger context window")
		}
	}
	return nil
}

// FitModelContext reduces derived evidence after the caller accounts for its
// complete model-specific request framing. Canonical records are untouched.
func FitModelContext(value *Context, profile agent.ContextPolicy, tokens int) error {
	return fitContext(value, contextBudget{profile: profile, adaptive: true, total: max(0, tokens)})
}
