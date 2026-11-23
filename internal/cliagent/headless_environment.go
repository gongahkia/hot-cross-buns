package cliagent

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func prepareHeadlessEnvironment(cmd *exec.Cmd, cfg Config, edit bool) error {
	if cfg.Kind != "opencode" && cfg.Kind != "gemini" && cfg.Kind != "copilot" {
		return nil
	}
	home := ""
	for _, value := range cmd.Env {
		if strings.HasPrefix(value, "HOME=") {
			home = strings.TrimPrefix(value, "HOME=")
		}
	}
	if home == "" {
		return errors.New("CLI sandbox has no private HOME")
	}
	switch cfg.Kind {
	case "opencode":
		permissions := []map[string]string{{"action": "*", "resource": "*", "effect": "deny"}}
		for _, name := range []string{"read", "glob", "grep"} {
			permissions = append(permissions, map[string]string{"action": name, "resource": "*", "effect": "allow"})
		}
		if edit {
			permissions = append(permissions, map[string]string{"action": "edit", "resource": "*", "effect": "allow"})
		}
		content, _ := json.Marshal(map[string]any{"permissions": permissions, "plugins": []string{}, "mcp": map[string]any{}, "instructions": []string{}, "autoupdate": false, "snapshot": false})
		cmd.Env = append(cmd.Env, "OPENCODE_CONFIG_CONTENT="+string(content), "OPENCODE_CONFIG_PROJECT_DISABLE=true", "OPENCODE_DISABLE_PROJECT_CONFIG=true", "OPENCODE_DISABLE_CLAUDE_CODE=true", "OPENCODE_DISABLE_AUTOUPDATE=true", "OPENCODE_DISABLE_FILEWATCHER=true", "OPENCODE_DB="+filepath.Join(home, "opencode.db"))
	case "gemini":
		names := []string{"read_file", "list_directory", "glob", "grep_search", "read_many_files"}
		if edit {
			names = append(names, "replace", "write_file")
		}
		settings := map[string]any{"tools": map[string]any{"core": names, "allowed": names}, "advanced": map[string]any{"ignoreLocalEnv": true}, "telemetry": map[string]any{"enabled": false}, "hooks": map[string]any{"enabled": false}, "mcp": map[string]any{"allowed": []string{}}, "context": map[string]any{"fileName": ".hot-cross-buns-no-context.md"}, "model": map[string]any{"maxSessionTurns": 16}, "security": map[string]any{"auth": map[string]any{"selectedType": "gemini-api-key"}, "allowedExtensions": []string{"^$"}}}
		data, _ := json.Marshal(settings)
		file := filepath.Join(home, "gemini-settings.json")
		if err := os.WriteFile(file, data, 0600); err != nil {
			return err
		}
		cmd.Env = append(cmd.Env, "GEMINI_CLI_SYSTEM_SETTINGS_PATH="+file, "GEMINI_TELEMETRY_ENABLED=false")
	case "copilot":
		copilotHome := filepath.Join(home, ".copilot")
		if err := os.MkdirAll(copilotHome, 0700); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(copilotHome, "settings.json"), []byte(`{"disableAllHooks":true}`), 0600); err != nil {
			return err
		}
		endpoint := cfg.BaseURL
		if endpoint == "" {
			endpoint = "https://api.openai.com/v1"
		}
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Scheme != "https" {
			return errors.New("Copilot requires its configured HTTPS model endpoint")
		}
		cmd.Env = append(cmd.Env, "COPILOT_PROVIDER_TYPE=openai", "COPILOT_PROVIDER_BASE_URL="+endpoint, "COPILOT_PROVIDER_WIRE_API=responses", "COPILOT_PROVIDER_MAX_OUTPUT_TOKENS=4096", "COPILOT_PROVIDER_MAX_PROMPT_TOKENS=32768", "COPILOT_AUTO_UPDATE=false", "COPILOT_PLUGIN_DIR_ONLY=true", "COPILOT_HOME="+copilotHome)
	}
	return nil
}
