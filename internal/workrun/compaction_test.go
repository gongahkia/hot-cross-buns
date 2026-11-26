package workrun

import (
	"context"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

type compactionModel struct {
	requests []agent.TurnRequest
}

func (m *compactionModel) Complete(_ context.Context, request agent.TurnRequest) (agent.Turn, error) {
	m.requests = append(m.requests, request)
	return agent.Turn{Text: "Objective: finish parser. Changed: parser.go. Verification: pending."}, nil
}

func TestCompactRetainedContextKeepsRecentWorkHistory(t *testing.T) {
	messages := make([]agent.Message, 0, 14)
	for index := 0; index < 14; index++ {
		messages = append(messages, agent.Message{Role: agent.RoleUser, Content: strings.Repeat(string(rune('a'+index%26)), 8*1024)})
	}
	model := &compactionModel{}
	compacted, summary, didCompact, err := compactRetainedContext(context.Background(), agent.WithContextPolicy(model, agent.ContextPolicy{Window: 65536, OutputReserve: 8192}), messages)
	if err != nil {
		t.Fatalf("compact retained context: %v", err)
	}
	if !didCompact || !strings.Contains(summary, "parser.go") || len(compacted) >= len(messages) {
		t.Fatalf("compaction result = compacted:%t summary:%q messages:%d", didCompact, summary, len(compacted))
	}
	if !strings.HasPrefix(compacted[0].Content, retainedContextPrefix) || compacted[len(compacted)-1].Content != messages[len(messages)-1].Content {
		t.Fatalf("compacted history = %#v", compacted[:2])
	}
	if len(model.requests) < 1 || len(model.requests[0].Messages) < 2 {
		t.Fatalf("compaction request = %#v", model.requests)
	}
}

func TestLargerModelRetainsTheSameWorkWithoutCompacting(t *testing.T) {
	messages := []agent.Message{}
	for i := 0; i < 14; i++ {
		messages = append(messages, agent.Message{Role: agent.RoleUser, Content: strings.Repeat("context", 1200)})
	}
	model := &compactionModel{}
	_, _, changed, err := compactRetainedContext(context.Background(), agent.WithContextPolicy(model, agent.ContextPolicy{Window: 262144, OutputReserve: 8192}), messages)
	if err != nil || changed || len(model.requests) != 0 {
		t.Fatal("larger model compacted fitting history", changed, err)
	}
}
