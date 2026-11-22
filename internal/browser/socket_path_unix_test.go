//go:build darwin || linux

package browser

import (
	"strings"
	"testing"
)

func TestSocketPathFitsMacOSTemporaryDirectory(t *testing.T) {
	t.Setenv("TMPDIR", "/var/folders/ab/"+strings.Repeat("c", 31)+"/T")
	path := socketPath(nil, "browser-session-with-a-long-identifier")
	if len(path) >= 104 {
		t.Fatalf("browser socket path exceeds the macOS limit: %d bytes: %q", len(path), path)
	}
}
