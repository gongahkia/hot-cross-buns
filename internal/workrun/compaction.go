package workrun

import (
	"context"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

const retainedContextPrefix = "Hot Cross Buns compacted context from earlier turns:\n"

// compactRetainedContext keeps Work conversation history bounded before the
// next Work transaction. It lives with Work because its result becomes part of
// a Work revision; it is not a dependency on the legacy run/session runtime.
func compactRetainedContext(ctx context.Context, model agent.Model, messages []agent.Message) ([]agent.Message, string, bool, error) {
	request, summary, err := agent.CompactContext(ctx, model, agent.TurnRequest{Messages: messages})
	return request.Messages, summary, summary != "", err
}
