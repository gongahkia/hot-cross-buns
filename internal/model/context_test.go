package model

import "testing"

func TestModelContextLimitsUseExactIdentitiesAndDeploymentFallback(t *testing.T) {
	for _, item := range []struct {
		provider, model string
		window          int
	}{{"openai", "gpt-5.6", 1050000}, {"openai", "gpt-5-mini", 400000}, {"anthropic", "claude-sonnet-5", 1000000}, {"anthropic", "claude-haiku-4-5", 200000}, {"gemini", "gemini-3.5-flash", 1048576}, {"azure-openai", "gpt-5.6", 32768}, {"openai", "gpt-5.6-private-deployment", 32768}, {"hot-cross-buns-local", "qwen3", 4096}} {
		p := ContextPolicy(item.provider, item.model)
		if p.Window != item.window || p.InputLimit()+p.OutputReserve >= p.Window {
			t.Fatal(item, p)
		}
	}
	if p := ContextPolicy("openai", "gpt-6.2-sol"); p.InputLimit() > 922000 {
		t.Fatal("ignored input-only provider limit", p)
	}
}
