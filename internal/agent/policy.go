package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type PolicyStage string

const (
	PolicyInput       PolicyStage = "input"
	PolicyToolInput   PolicyStage = "tool_input"
	PolicyToolOutput  PolicyStage = "tool_output"
	PolicyFinal       PolicyStage = "final"
	PolicyModelOutput PolicyStage = "model_output"
)

type PolicyAction string

const (
	PolicyAllow    PolicyAction = "allow"
	PolicyBlock    PolicyAction = "block"
	PolicyApproval PolicyAction = "approval"
	PolicyRedact   PolicyAction = "redact"
	PolicyVerify   PolicyAction = "verify"
)

// PolicyInput is passed only to trusted host rules. A model cannot register a
// rule or change its decision. Domain authorization still runs in BeforeTool.
type PolicyInputValue struct {
	Stage       PolicyStage
	Text        string
	Call        *ToolCall
	Messages    []Message
	Images      []Image
	Attachments []Attachment
	Result      *ToolResult
	redacted    *bool
}
type PolicyDecision struct {
	Action      PolicyAction
	Reason      string
	Replacement string
}
type PolicyRule struct {
	ID    string
	Check func(context.Context, PolicyInputValue) (PolicyDecision, error)
}

var ErrPolicy = errors.New("host policy blocked execution")

func evaluatePolicy(ctx context.Context, options RunOptions, value PolicyInputValue) (string, error) {
	if !utf8.ValidString(value.Text) || len(value.Text) > 8*1024*1024 {
		return "", fmt.Errorf("%w: invalid or oversized %s", ErrPolicy, value.Stage)
	}
	for _, rule := range options.Policies {
		if rule.ID == "" || len(rule.ID) > 128 || rule.Check == nil {
			return "", fmt.Errorf("%w: invalid rule", ErrPolicy)
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
		decision, err := rule.Check(ctx, value)
		if err != nil {
			return "", fmt.Errorf("%w: rule %s failed", ErrPolicy, rule.ID)
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if options.OnEvent != nil {
			outcome := decision.Action
			switch outcome {
			case PolicyAllow, PolicyBlock, PolicyApproval, PolicyRedact, PolicyVerify:
			default:
				outcome = "invalid"
			}
			options.OnEvent(Event{Kind: EventPolicyDecision, At: time.Now(), Outcome: string(outcome)})
		}
		switch decision.Action {
		case PolicyAllow:
		case PolicyBlock:
			return "", fmt.Errorf("%w: %s", ErrPolicy, rule.ID)
		case PolicyApproval:
			if options.ApprovePolicy == nil {
				return "", fmt.Errorf("%w: approval unavailable for %s", ErrPolicy, rule.ID)
			}
			approved, err := options.ApprovePolicy(ctx, rule.ID, value, decision.Reason)
			if contextErr := ctx.Err(); contextErr != nil {
				return "", contextErr
			}
			if err != nil {
				return "", err
			}
			if !approved {
				return "", fmt.Errorf("%w: approval declined for %s", ErrPolicy, rule.ID)
			}
		case PolicyRedact:
			// Task redaction would diverge from the admitted task and scope binding.
			if value.Stage == PolicyInput || !utf8.ValidString(decision.Replacement) || len(decision.Replacement) > 8*1024*1024 {
				return "", fmt.Errorf("%w: invalid redaction", ErrPolicy)
			}
			if value.redacted != nil {
				*value.redacted = true
			}
			value.Text = decision.Replacement
			if value.Stage == PolicyToolInput && !json.Valid([]byte(value.Text)) {
				return "", fmt.Errorf("%w: invalid argument redaction", ErrPolicy)
			}
		case PolicyVerify:
			if value.Stage != PolicyFinal || strings.TrimSpace(decision.Reason) == "" || len(decision.Reason) > 2048 {
				return "", fmt.Errorf("%w: invalid verification request", ErrPolicy)
			}
			return "", verificationRequired{decision.Reason}
		default:
			return "", fmt.Errorf("%w: invalid decision by %s", ErrPolicy, rule.ID)
		}
	}
	return value.Text, nil
}

type verificationRequired struct{ reason string }

func (v verificationRequired) Error() string { return v.reason }

func validateTurn(turn Turn) error {
	if !utf8.ValidString(turn.Text) || len(turn.Text) > 8*1024*1024 || len(turn.ToolCalls) > 64 {
		return errors.New("invalid or oversized model turn")
	}
	ids := map[string]bool{}
	for _, call := range turn.ToolCalls {
		if (call.ID != "" && ids[call.ID]) || len(call.ID) > 1024 || len(call.Name) > 256 || len(call.Arguments) > 8*1024*1024 {
			return errors.New("invalid or duplicate model tool call identity")
		}
		ids[call.ID] = true
	}
	return nil
}

// CheckHostPolicy applies the same boundary contract to a hosted worker. Tool
// permissions inside a CLI still belong to its native approval/sandbox broker.
func CheckHostPolicy(ctx context.Context, rules []PolicyRule, stage PolicyStage, text string) (string, error) {
	return evaluatePolicy(ctx, RunOptions{Policies: rules}, PolicyInputValue{Stage: stage, Text: text})
}
