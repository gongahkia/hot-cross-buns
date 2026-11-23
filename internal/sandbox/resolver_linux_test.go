package sandbox

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestNetworkSandboxMountsOnlyExternalResolverFile(t *testing.T) {
	if _, err := StrictAvailability(); err != nil {
		t.Skip(err)
	}
	resolver, err := filepath.EvalSymlinks("/etc/resolv.conf")
	if err != nil {
		t.Skip(err)
	}
	root, scratch := t.TempDir(), t.TempDir()
	for _, network := range []Network{AllowNetwork, DenyNetwork} {
		cmd, err := prepareLinux(context.Background(), root, scratch, []string{"/usr/bin/true"}, nil, Policy{Mode: Strict, Network: network})
		if err != nil {
			t.Fatal(err)
		}
		mounted := false
		for i, arg := range cmd.Args {
			if arg == "--ro-bind" && i+2 < len(cmd.Args) && cmd.Args[i+1] == resolver {
				mounted = true
			}
			if arg == "--ro-bind" && i+1 < len(cmd.Args) && cmd.Args[i+1] == "/run" {
				t.Fatal("exposed all runtime files")
			}
		}
		external := !strings.HasPrefix(resolver, "/etc/")
		if mounted != (external && network == AllowNetwork) {
			t.Fatalf("resolver mount=%v network=%v", mounted, network)
		}
	}
}
