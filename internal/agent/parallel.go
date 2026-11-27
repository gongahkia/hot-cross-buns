package agent

import (
	"context"
	"sync"
)

type toolExecution struct {
	result   ToolResult
	err      error
	executed bool
}

// Only Execute runs concurrently. Host approvals, events, policies, hooks and
// replay publication stay ordered on the runner goroutine.
func parallelReads(ctx context.Context, tools map[string]Tool, calls []ToolCall, before func(context.Context, ToolCall) error) []toolExecution {
	out := make([]toolExecution, len(calls))
	for i, call := range calls {
		out[i].err = ctx.Err()
		if out[i].err == nil && before != nil {
			out[i].err = before(ctx, *cloneCall(call))
		}
	}
	var wg sync.WaitGroup
	for i, call := range calls {
		if out[i].err != nil {
			continue
		}
		wg.Add(1)
		go func(i int, call ToolCall) {
			defer wg.Done()
			if err := ctx.Err(); err != nil {
				out[i].err = err
				return
			}
			out[i].executed = true
			out[i].result, out[i].err = executeTool(ctx, tools, call)
		}(i, call)
	}
	wg.Wait()
	return out
}
func independentBatch(calls []ToolCall, start, limit int, read func(ToolCall) bool) int {
	end := start
	if read != nil {
		for end < len(calls) && end-start < limit && read(*cloneCall(calls[end])) {
			end++
		}
	}
	return max(start+1, end)
}
