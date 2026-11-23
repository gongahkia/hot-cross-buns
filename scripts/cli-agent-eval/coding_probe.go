package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/patch"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func runCodingProbe(ctx context.Context, cfg cliagent.Config, root, source string) error {
	original := "def add(a, b):\n    return a - b\n"
	file := filepath.Join(source, "calculator.py")
	if err := os.WriteFile(file, []byte(original), 0600); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	result, runErr := cliagent.Run(ctx, cliagent.Request{Config: cfg, Source: source, Scratch: filepath.Join(root, "scratch"), ID: "coding", Task: "Fix only calculator.py so add(a,b) returns their sum, including negative inputs. Do not change project.md. Return a short summary; the host will independently run tests on your patch.", Edit: true, Scopes: []string{"calculator.py"}})
	checks := map[string]bool{"worker_completed": runErr == nil, "patch_returned": len(result.Patch) > 0}
	current, _ := os.ReadFile(file)
	checks["original_unchanged"] = string(current) == original
	if runErr == nil && len(result.Patch) > 0 {
		verify := filepath.Join(root, "verification")
		err := patch.InitSnapshot(ctx, source, verify)
		if err == nil {
			err = patch.ApplySnapshot(ctx, verify, result.Patch)
		}
		if err == nil {
			python, pathErr := exec.LookPath("python3")
			if pathErr != nil {
				err = pathErr
			} else {
				prepared, prepareErr := sandbox.Prepare(ctx, sandbox.Request{Dir: verify, Argv: []string{python, "-B", "-c", "from calculator import add; assert add(3,2)==5; assert add(-1,1)==0; assert add(0,0)==0"}, Policy: sandbox.Policy{Mode: sandbox.Strict, Network: sandbox.DenyNetwork}})
				if prepareErr != nil {
					err = prepareErr
				} else {
					err = prepared.Command.Run()
					prepared.Cleanup()
				}
			}
		}
		checks["independent_tests_passed"] = err == nil
	}
	passed := len(checks) == 4
	for _, value := range checks {
		passed = passed && value
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"kind": cfg.Kind, "model": cfg.Model, "passed": passed, "checks": checks, "summary": result.Summary, "patch_bytes": len(result.Patch)}); err != nil {
		return err
	}
	if !passed {
		return fmt.Errorf("coding probe failed (checks: %v, worker error: %v)", checks, runErr)
	}
	return nil
}
