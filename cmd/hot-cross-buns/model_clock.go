package main

import (
	"context"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"time"
)

func modelClock(request agent.TurnRequest) agent.TurnRequest {
	zone := "Local"
	if settings, err := loadSettings(); err == nil && settings.JobDefaults.Timezone != "" {
		zone = settings.JobDefaults.Timezone
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		location = time.Local
		zone = "device time"
	}
	request.System += fmt.Sprintf("\n\nHost clock: current_time=%s; user_timezone=%s. This timestamp is refreshed for every model request. Resolve relative dates in this timezone unless the task explicitly specifies a different scheduling timezone. A past scheduled time is late, not evidence that a reminder was delivered or a task completed. Prefer collecting related durable facts and asking any necessary clarifications before saving them together; do not save routine conversation or narrate a memory update after every reply.", time.Now().In(location).Format(time.RFC3339), zone)
	return request
}
func (b *nativeWorkBackend) Complete(ctx context.Context, request agent.TurnRequest) (agent.Turn, error) {
	return b.Model.Complete(ctx, modelClock(request))
}
