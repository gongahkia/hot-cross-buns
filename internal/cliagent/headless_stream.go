package cliagent

import (
	"encoding/json"
	"errors"
)

// headless events contribute only assistant text and explicit terminal outcomes.
func (s *streamState) acceptHeadless(kind string, line []byte) error {
	var event struct {
		Type     string `json:"type"`
		ExitCode *int   `json:"exitCode"`
		Role     string `json:"role"`
		Content  string `json:"content"`
		Status   string `json:"status"`
		Result   string `json:"result"`
		Subtype  string `json:"subtype"`
		Delta    bool   `json:"delta"`
		IsError  bool   `json:"is_error"`
		Part     struct {
			Text   string `json:"text"`
			Reason string `json:"reason"`
			Tokens struct {
				Input  int64 `json:"input"`
				Output int64 `json:"output"`
			} `json:"tokens"`
		} `json:"part"`
		Stats struct {
			Input  int64 `json:"input_tokens"`
			Output int64 `json:"output_tokens"`
		} `json:"stats"`
		Data struct {
			Content   string `json:"content"`
			Message   string `json:"message"`
			ErrorType string `json:"errorType"`
		} `json:"data"`
	}
	if json.Unmarshal(line, &event) != nil {
		return errors.New("CLI emitted malformed JSON")
	}
	switch kind {
	case "opencode":
		if event.Type == "text" {
			s.summary += event.Part.Text
			s.turns++
		}
		if event.Type == "step_finish" {
			s.usage.InputTokens += event.Part.Tokens.Input
			s.usage.OutputTokens += event.Part.Tokens.Output
			s.usage.Reported = true
			if event.Part.Reason == "stop" {
				s.complete = true
			}
		}
		if event.Type == "error" {
			s.failed = true
			s.diagnostic = "OpenCode reported an error"
		}
	case "gemini":
		if event.Type == "message" && event.Role == "assistant" {
			if !event.Delta {
				s.summary = ""
				s.turns++
			}
			s.summary += event.Content
		}
		if event.Type == "result" {
			s.complete = true
			s.failed = s.failed || event.Status != "success"
			s.usage.InputTokens = event.Stats.Input
			s.usage.OutputTokens = event.Stats.Output
			s.usage.Reported = true
		}
	case "copilot":
		if event.Type == "assistant.message" {
			s.summary = event.Data.Content
			s.turns++
		}
		if event.Type == "session.error" {
			s.failed = true
			s.diagnostic = "Copilot reported a session error"
		}
		if event.Type == "result" {
			s.complete = true
			if event.ExitCode != nil {
				s.failed = s.failed || *event.ExitCode != 0
			} else {
				s.failed = s.failed || event.IsError || event.Subtype != "success"
				s.summary = event.Result
				s.turns++
			}
		}
	}
	if len(s.summary) > 32768 {
		return errors.New("CLI summary exceeds 32 KiB")
	}
	if s.turns > 16 {
		return errors.New("CLI exceeded 16 observed assistant messages")
	}
	return nil
}
