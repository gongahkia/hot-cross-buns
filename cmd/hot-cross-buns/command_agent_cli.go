package main

import (
	"errors"
	"flag"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

const agentCLIUsage = `usage:
  hot-cross-buns agent cli list
  hot-cross-buns agent cli enable codex|claude|pi|opencode|gemini|copilot [--executable PATH] [--model ID] [--base-url HTTPS_URL] [--provider ID] [--auth codex_login|api_key] [--codex-home PATH] [--api-key-env NAME] [--timeout SECONDS] [--allow-edits] [--runtime-root PATH]
  hot-cross-buns agent cli disable codex|claude|pi|opencode|gemini|copilot
  hot-cross-buns agent cli doctor codex|claude|pi|opencode|gemini|copilot`

func agentCLICommand(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New(agentCLIUsage)
	}
	store, err := config.DefaultStore()
	if err != nil {
		return err
	}
	settings, err := store.Load()
	if err != nil {
		return err
	}
	if len(args) == 1 && args[0] == "list" {
		for _, kind := range []string{"codex", "claude", "pi", "opencode", "gemini", "copilot"} {
			status := "disabled"
			configuredPath := ""
			for _, c := range settings.ExternalAgents {
				if c.Kind == kind {
					status = "enabled"
					configuredPath = c.Executable
				}
			}
			path, err := exec.LookPath(kind)
			if err != nil {
				path = "not installed on PATH"
			}
			if configuredPath != "" {
				path = configuredPath
			}
			if _, err := fmt.Fprintf(out, "%s  %s  %s\n", kind, status, path); err != nil {
				return err
			}
		}
		return nil
	}
	if len(args) < 2 {
		return errors.New(agentCLIUsage)
	}
	kind := args[1]
	if !cliagent.Supported(kind) {
		return errors.New(agentCLIUsage)
	}
	switch args[0] {
	case "enable":
		flags := flag.NewFlagSet("agent cli enable", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		executable := flags.String("executable", kind, "installed CLI executable")
		baseURL := flags.String("base-url", "", "provider API base URL")
		model := flags.String("model", "", "CLI model")
		provider := flags.String("provider", "", "Pi provider")
		defaultKey := "OPENAI_API_KEY"
		if kind == "claude" {
			defaultKey = "ANTHROPIC_API_KEY"
		}
		if kind == "gemini" {
			defaultKey = "GEMINI_API_KEY"
		}
		key := flags.String("api-key-env", defaultKey, "credential environment name, never value")
		authMode := flags.String("auth", "", "api_key or codex_login (Codex defaults to its local login)")
		codexHome := flags.String("codex-home", "", "local Codex home, used only for its ChatGPT login")
		timeout := flags.Int("timeout", 300, "seconds per invocation")
		edit := flags.Bool("allow-edits", false, "permit private patch creation in draft/act Work")
		var roots evidenceValues
		flags.Var(&roots, "runtime-root", "read-only runtime/package root")
		if err := flags.Parse(args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New(agentCLIUsage)
		}
		path, err := exec.LookPath(*executable)
		if err != nil {
			return err
		}
		path, err = filepath.EvalSymlinks(path)
		if err != nil {
			return err
		}
		path, err = filepath.Abs(path)
		if err != nil {
			return err
		}
		// Native standalone tools need their adjacent assets; JS launchers also
		// need their installed package and the Node runtime, never the user's HOME.
		runtimeRoots := []string{filepath.Dir(path)}
		if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".mjs") {
			for dir := filepath.Dir(path); dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
				if filepath.Base(dir) == "node_modules" {
					runtimeRoots = append(runtimeRoots, dir)
					break
				}
			}
			node, err := exec.LookPath("node")
			if err != nil {
				return err
			}
			node, err = filepath.EvalSymlinks(node)
			if err != nil {
				return err
			}
			runtimeRoots = append(runtimeRoots, filepath.Dir(filepath.Dir(node)))
		}
		for _, root := range roots {
			canonical, err := filepath.EvalSymlinks(root)
			if err != nil {
				return err
			}
			canonical, err = filepath.Abs(canonical)
			if err != nil {
				return err
			}
			runtimeRoots = append(runtimeRoots, canonical)
		}
		slices.Sort(runtimeRoots)
		runtimeRoots = slices.Compact(runtimeRoots)
		c := cliagent.Config{Kind: kind, Executable: path, Model: *model, BaseURL: *baseURL, Provider: *provider, APIKeyEnv: *key, TimeoutSeconds: *timeout, AllowEdits: *edit, ReadOnlyRoots: runtimeRoots}
		if kind == "codex" {
			c.AuthMode = *authMode
			if c.AuthMode == "" {
				c.AuthMode = "codex_login"
			}
			if c.UsesCodexLogin() {
				explicitKey := false
				flags.Visit(func(f *flag.Flag) {
					if f.Name == "api-key-env" {
						explicitKey = true
					}
				})
				if explicitKey {
					return errors.New("--api-key-env requires --auth api_key; local Codex login does not consume API keys")
				}
				c.APIKeyEnv = ""
				c.CodexHome = *codexHome
				if c.CodexHome == "" {
					c.CodexHome = os.Getenv("CODEX_HOME")
				}
				if c.CodexHome == "" {
					home, err := os.UserHomeDir()
					if err != nil {
						return err
					}
					c.CodexHome = filepath.Join(home, ".codex")
				}
				c.CodexHome, err = filepath.Abs(c.CodexHome)
				if err != nil {
					return err
				}
			}
		} else if *authMode != "" || *codexHome != "" {
			return errors.New("local login selection is only supported for Codex")
		}
		if c.Kind == "pi" && c.Provider == "" {
			c.Provider = "openai"
		}
		if err := c.Validate(); err != nil {
			return err
		}
		if err := store.Update(func(s *config.Settings) error {
			s.ExternalAgents = slices.DeleteFunc(s.ExternalAgents, func(c cliagent.Config) bool { return c.Kind == kind })
			s.ExternalAgents = append(s.ExternalAgents, c)
			return nil
		}); err != nil {
			return err
		}
		_, err = fmt.Fprintf(out, "Enabled %s as cli_%s; isolated runs, %ds timeout, authentication %s. Restart Hot Cross Buns to refresh available agents.\n", kind, kind, *timeout, func() string {
			if c.UsesCodexLogin() {
				return "local Codex ChatGPT login"
			}
			return c.APIKeyEnv
		}())
		return err
	case "disable":
		if len(args) != 2 {
			return errors.New(agentCLIUsage)
		}
		if err := store.Update(func(s *config.Settings) error {
			s.ExternalAgents = slices.DeleteFunc(s.ExternalAgents, func(c cliagent.Config) bool { return c.Kind == kind })
			return nil
		}); err != nil {
			return err
		}
		_, err = fmt.Fprintf(out, "Disabled %s for new runs. Existing runs retain their reviewed configuration.\n", kind)
		return err
	case "doctor":
		if len(args) != 2 {
			return errors.New(agentCLIUsage)
		}
		for _, c := range settings.ExternalAgents {
			if c.Kind == kind {
				if _, err := os.Stat(c.Executable); err != nil {
					return err
				}
				mechanism, err := sandbox.StrictAvailability()
				if err != nil {
					return err
				}
				if c.UsesCodexLogin() {
					if _, err := os.Stat(filepath.Join(c.CodexHome, "auth.json")); err != nil {
						return errors.New("run codex login locally first")
					}
					_, err = fmt.Fprintf(out, "%s: local Codex login selected; provider authentication is checked when a task runs.\n", kind)
					return err
				}
				if os.Getenv(c.APIKeyEnv) == "" {
					return fmt.Errorf("%s is not set in this process", c.APIKeyEnv)
				}
				_, err = fmt.Fprintf(out, "%s: executable present; credential available; %s available. Provider authentication and CLI protocol are checked when a task runs.\n", kind, mechanism)
				return err
			}
		}
		return fmt.Errorf("%s is not enabled", kind)
	default:
		return errors.New(agentCLIUsage)
	}
}
