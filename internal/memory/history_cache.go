package memory

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

// Cache notification is best effort. Writes stay canonical; preparation also
// reconciles exact dependency versions and privacy rules before using a cache.
func (s Store) notifyHistoryCache(id, goal string, origins map[string]bool) {
	stateDir := filepath.Dir(filepath.Dir(s.root))
	info, err := os.Lstat(filepath.Join(stateDir, "hot-cross-buns", "cache", "conversations-v1.sqlite"))
	if err != nil || !info.Mode().IsRegular() {
		return
	}
	sessions, err := worksession.Open(stateDir)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if id != "" {
		_ = sessions.InvalidateHistoryMemory(ctx, id)
	}
	if len(origins) > 0 {
		_ = sessions.InvalidateHistoryOrigins(ctx, goal, origins)
	}
}
