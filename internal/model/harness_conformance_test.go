package model_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/model/anthropic"
	"github.com/gongahkia/hot-cross-buns/internal/model/chatcompletions"
	"github.com/gongahkia/hot-cross-buns/internal/model/gemini"
	"github.com/gongahkia/hot-cross-buns/internal/model/openai"
	"github.com/gongahkia/hot-cross-buns/internal/model/radius"
)

type harnessAdapter struct {
	name   string
	wire   string
	native bool
	new    func(*httptest.Server) agent.Model
}

func harnessAdapters() []harnessAdapter {
	return []harnessAdapter{
		{"responses", "responses", true, func(s *httptest.Server) agent.Model {
			return openai.Responses{APIKey: "fixture", Model: "fixture", BaseURL: s.URL, Client: s.Client()}
		}},
		{"messages", "messages", true, func(s *httptest.Server) agent.Model {
			return anthropic.Messages{APIKey: "fixture", Model: "fixture", BaseURL: s.URL, Client: s.Client()}
		}},
		{"gemini", "gemini", true, func(s *httptest.Server) agent.Model {
			return gemini.GenerateContent{APIKey: "fixture", Model: "fixture", BaseURL: s.URL, Client: s.Client()}
		}},
		{"chat-schema", "chat", true, func(s *httptest.Server) agent.Model {
			return chatcompletions.Model{Config: chatcompletions.Config{APIKey: "fixture", Model: "fixture", BaseURL: s.URL, Client: s.Client(), NativeStructured: true}}
		}},
		{"chat-local-fallback", "chat", false, func(s *httptest.Server) agent.Model {
			return chatcompletions.Model{Config: chatcompletions.Config{AllowEmptyAPIKey: true, Model: "fixture", BaseURL: s.URL, Client: s.Client()}}
		}},
		{"radius-fallback", "radius", false, func(s *httptest.Server) agent.Model {
			return radius.Messages{APIKey: "fixture", Model: "fixture", BaseURL: s.URL, Client: s.Client()}
		}},
	}
}
func harnessResponse(w http.ResponseWriter, wire string, stream bool, text string, call bool) {
	if wire == "radius" {
		w.Header().Set("Content-Type", "text/event-stream")
		if call {
			io.WriteString(w, "data: {\"type\":\"toolcall_end\",\"toolCall\":{\"id\":\"call-1\",\"name\":\"read_file\",\"arguments\":{}}}\n\n")
		} else {
			payload, _ := json.Marshal(map[string]any{"type": "text_delta", "delta": text})
			fmt.Fprintf(w, "data: %s\n\n", payload)
		}
		io.WriteString(w, "data: {\"type\":\"done\"}\n\n")
		return
	}

	var body any
	switch wire {
	case "responses":
		output := []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": text}}}}
		if call {
			output = []any{map[string]any{"id": "item", "type": "function_call", "call_id": "call-1", "name": "read_file", "arguments": "{}"}}
		}
		body = map[string]any{"output": output, "usage": map[string]any{"input_tokens": 12, "output_tokens": 3}}
	case "messages":
		blocks := []any{map[string]any{"type": "text", "text": text}}
		if call {
			blocks = []any{map[string]any{"type": "tool_use", "id": "call-1", "name": "read_file", "input": map[string]any{}}}
		}
		body = map[string]any{"content": blocks, "usage": map[string]any{"input_tokens": 12, "output_tokens": 3}}
	case "gemini":
		part := map[string]any{"text": text}
		if call {
			part = map[string]any{"functionCall": map[string]any{"id": "call-1", "name": "read_file", "args": map[string]any{}}, "thoughtSignature": "retained-signature"}
		}
		body = map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"role": "model", "parts": []any{part}}}}, "usageMetadata": map[string]any{"promptTokenCount": 12, "candidatesTokenCount": 3}}
	case "chat":
		message := map[string]any{"role": "assistant", "content": text}
		if call {
			message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "read_file", "arguments": "{}"}}}
		}
		body = map[string]any{"choices": []any{map[string]any{"message": message}}, "usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 3}}
	}
	if !stream {
		_ = json.NewEncoder(w).Encode(body)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	if wire == "responses" {
		payload, _ := json.Marshal(map[string]any{"type": "response.completed", "response": body})
		fmt.Fprintf(w, "data: %s\n\n", payload)
		return
	}
	if wire == "messages" {
		if call {
			io.WriteString(w, "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call-1\",\"name\":\"read_file\",\"input\":{}}}\n\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n")
		} else {
			io.WriteString(w, "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n")
			payload, _ := json.Marshal(map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": text}})
			fmt.Fprintf(w, "data: %s\n\n", payload)
		}
		io.WriteString(w, "data: {\"type\":\"message_stop\"}\n\n")
	}
}

type harnessRead struct{ calls *atomic.Int32 }

func (h harnessRead) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "read_file", Parameters: json.RawMessage(`{"type":"object"}`)}
}
func (h harnessRead) Execute(context.Context, json.RawMessage) (agent.ToolResult, error) {
	h.calls.Add(1)
	return agent.ToolResult{Content: "retained-evidence"}, nil
}

func TestHarnessProviderConformance(t *testing.T) {
	for _, adapter := range harnessAdapters() {
		t.Run(adapter.name, func(t *testing.T) {
			t.Run("structured-contract-and-bounded-repair", func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					raw, _ := io.ReadAll(r.Body)
					calls++
					native := strings.Contains(string(raw), `"output_config"`) || strings.Contains(string(raw), `"responseJsonSchema"`) || strings.Contains(string(raw), `"response_format"`) || strings.Contains(string(raw), `"format":{"name"`)
					if adapter.wire == "responses" {
						var body map[string]any
						_ = json.Unmarshal(raw, &body)
						native = body["text"] != nil
					}
					if native != adapter.native {
						t.Errorf("native schema present=%v want %v", native, adapter.native)
					}
					text := `{"kind":"ok","extra":true}`
					if calls == 2 {
						text = `{"kind":"ok"}`
					}
					harnessResponse(w, adapter.wire, false, text, false)
				}))
				defer server.Close()
				type decision struct {
					Kind string `json:"kind"`
				}
				got, err := agent.CompleteStructured[decision](context.Background(), adapter.new(server), agent.TurnRequest{Messages: []agent.Message{{Role: agent.RoleUser, Content: "classify"}}}, agent.OutputContract{Name: "decision", Schema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"type":"string","enum":["ok"]}}}`)}, nil)
				if err != nil || got.Kind != "ok" || calls != 2 {
					t.Fatal(got, err, calls)
				}
			})
			t.Run("retry-correlation-and-domain-approval", func(t *testing.T) {
				for _, deny := range []bool{false, true} {
					calls := 0
					effects := &atomic.Int32{}
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						raw, _ := io.ReadAll(r.Body)
						var body map[string]any
						_ = json.Unmarshal(raw, &body)
						calls++
						if calls == 1 {
							w.WriteHeader(503)
							io.WriteString(w, `{"error":{"message":"temporarily unavailable"}}`)
							return
						}
						if calls == 3 {
							if !strings.Contains(string(raw), "call-1") {
								t.Error("lost tool correlation")
							}
							if !deny && !strings.Contains(string(raw), "retained-evidence") {
								t.Error("lost result")
							}
							if adapter.wire == "gemini" && !strings.Contains(string(raw), "retained-signature") {
								t.Error("lost thought signature")
							}
						}
						harnessResponse(w, adapter.wire, body["stream"] == true, "done", calls == 2)
					}))
					result, err := (agent.Runner{Model: adapter.new(server), Tools: []agent.Tool{harnessRead{effects}}}).Run(context.Background(), agent.RunOptions{Task: "inspect", BeforeTool: func(context.Context, agent.ToolCall) error {
						if deny {
							return errors.New("domain declined")
						}
						return nil
					}})
					server.Close()
					want := int32(1)
					if deny {
						want = 0
					}
					if err != nil || result.FinalText != "done" || effects.Load() != want || calls != 3 {
						t.Fatal(result, err, effects.Load(), calls)
					}
				}
			})
			t.Run("cancellation", func(t *testing.T) {
				entered := make(chan struct{}, 1)
				release := make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					entered <- struct{}{}
					select {
					case <-r.Context().Done():
					case <-release:
					}
				}))
				defer server.Close()
				defer close(release)
				ctx, cancel := context.WithCancel(context.Background())
				finished := make(chan error, 1)
				go func() {
					_, err := adapter.new(server).Complete(ctx, agent.TurnRequest{Messages: []agent.Message{{Role: agent.RoleUser, Content: "work"}}})
					finished <- err
				}()
				select {
				case <-entered:
				case <-time.After(3 * time.Second):
					cancel()
					t.Fatal("request did not arrive")
				}
				cancel()
				select {
				case err := <-finished:
					if !errors.Is(err, context.Canceled) {
						t.Fatal(err)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("cancellation did not settle")
				}
			})
			t.Run("steering-supersedes-unexecuted-calls", func(t *testing.T) {
				entered := make(chan struct{}, 1)
				release := make(chan struct{})
				calls := 0
				effects := &atomic.Int32{}
				steering := make(chan string, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					raw, _ := io.ReadAll(r.Body)
					var body map[string]any
					_ = json.Unmarshal(raw, &body)
					calls++
					if calls == 1 {
						entered <- struct{}{}
						<-release
					} else if !strings.Contains(string(raw), "change direction") {
						t.Error("steering lost")
					}
					harnessResponse(w, adapter.wire, body["stream"] == true, "done", calls == 1)
				}))
				defer server.Close()
				finished := make(chan error, 1)
				go func() {
					_, err := (agent.Runner{Model: adapter.new(server), Tools: []agent.Tool{harnessRead{effects}}}).Run(context.Background(), agent.RunOptions{Task: "inspect", Steering: steering})
					finished <- err
				}()
				<-entered
				steering <- "change direction"
				close(release)
				if err := <-finished; err != nil || effects.Load() != 0 || calls != 2 {
					t.Fatal(err, effects.Load(), calls)
				}
			})
		})
	}
}

func TestHarnessPartialStreamsAreNotRetried(t *testing.T) {
	for _, adapter := range harnessAdapters() {
		if adapter.wire != "responses" && adapter.wire != "messages" && adapter.wire != "radius" {
			continue
		}
		t.Run(adapter.name, func(t *testing.T) {
			calls := atomic.Int32{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				if adapter.wire == "responses" {
					io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")

				} else if adapter.wire == "radius" {
					io.WriteString(w, "data: {\"type\":\"text_delta\",\"delta\":\"partial\"}\n\n")
				} else {
					io.WriteString(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\n")
				}
			}))
			defer server.Close()

			var deltas string
			_, err := (agent.Runner{Model: adapter.new(server)}).Run(context.Background(), agent.RunOptions{Task: "work", OnEvent: func(e agent.Event) {
				if e.Kind == agent.EventTextDelta {
					deltas += e.Text
				}
			}})
			if err == nil || calls.Load() != 1 || deltas != "partial" {
				t.Fatal(err, calls.Load())
			}
		})
	}
}
