package model

import (
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"strings"
)

// Published limits are exact model identities, never inferred from a family
// prefix or an Azure deployment name. See docs/MODEL_CONTEXT_BUDGETS.md.
func ContextPolicy(provider, name string) agent.ContextPolicy {
	p := agent.ContextPolicy{Provider: provider, Model: name, Window: 32768, OutputReserve: 4096, Source: "unknown deployment fallback"}
	if provider == "openai" {
		switch name {
		case "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna":
			p.Window = 1050000
			p.Source = "OpenAI published model limit"
		case "gpt-6.2-sol":
			p.Window = 1050000
			p.MaxInput = 922000
			p.Source = "OpenAI published model limit"
		case "gpt-5-mini", "gpt-5-mini-2025-08-07":
			p.Window = 400000
			p.Source = "OpenAI published model limit"
		}
		if p.Source == "OpenAI published model limit" {
			p.Encoding = "o200k_base"
			p.OutputReserve = 32768
		}
	}
	if provider == "anthropic" {
		switch name {
		case "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2", "claude-sonnet-5", "claude-sonnet-4-6", "claude-opus-4-6":
			p.Window = 1000000
			p.OutputReserve = 8192
			p.Source = "Anthropic published model limit"
		case "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5":
			p.Window = 200000
			p.OutputReserve = 8192
			p.Source = "Anthropic published model limit"
		}
	}
	if provider == "gemini" && name == "gemini-3.5-flash" {
		p.Window = 1048576
		p.MaxInput = 1048576
		p.OutputReserve = 8192
		p.Source = "Google published model limit"
	}
	if strings.HasPrefix(provider, "hot-cross-buns-local") {
		p.Window = 4096
		p.OutputReserve = 1024
		p.Source = "unallocated local runtime fallback"
	}
	return p.Normalized()
}
