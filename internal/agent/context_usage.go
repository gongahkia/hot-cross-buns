package agent

import (
	"context"
	"strings"
	"time"
)

// ContextUsage describes an admitted request estimate, never billing or memory size.
type ContextUsage struct {
	Policy        ContextPolicy `json:"policy"`
	InputTokens   int           `json:"input_tokens"`
	InputLimit    int           `json:"input_limit"`
	OutputReserve int           `json:"output_reserve"`
	Summarized    bool          `json:"summarized"`
	At            time.Time     `json:"at"`
}
type contextReporterKey struct{}

func WithContextReporter(ctx context.Context, report func(ContextUsage)) context.Context {
	return context.WithValue(ctx, contextReporterKey{}, report)
}
func reportContext(ctx context.Context, p ContextPolicy, r TurnRequest) {
	report, _ := ctx.Value(contextReporterKey{}).(func(ContextUsage))
	if report == nil {
		return
	}
	limit := p.Window - max(256, p.Window/16) - r.MaxOutputTokens
	if p.MaxInput > 0 {
		limit = min(limit, p.MaxInput)
	}
	value := ContextUsage{Policy: p, InputTokens: p.RequestTokens(r), InputLimit: limit, OutputReserve: r.MaxOutputTokens, At: time.Now().UTC()}
	for _, m := range r.Messages {
		value.Summarized = value.Summarized || strings.HasPrefix(m.Content, compactedContextPrefix)
	}
	report(value)
}
