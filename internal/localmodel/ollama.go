package localmodel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	maxResponseBytes = 2 * 1024 * 1024
	maxProgressBytes = 64 * 1024
)

// Client invokes the Ollama management API over a literal loopback address.
// It intentionally cannot be configured to contact a remote inference server;
// callers needing that use the existing explicit custom-provider command.
type Client struct {
	baseURL *url.URL
	client  *http.Client
}

// InstalledModel is the bounded inventory returned by an Ollama runtime.
type InstalledModel struct {
	ContextLength int
	Name          string
	Size          int64
	SizeKnown     bool
	Digest        string
}

// Progress describes one pull status update. Its content is supplied by the
// local Ollama process and is display-only.
type Progress struct {
	Status    string
	Digest    string
	Completed int64
	Total     int64
}

// NewClient constructs a loopback-only client. An empty URL selects Ollama's
// standard local address.
func NewClient(rawURL string) (Client, error) {
	if strings.TrimSpace(rawURL) == "" {
		rawURL = DefaultBaseURL
	}
	parsed, err := LocalURL(rawURL)
	if err != nil {
		return Client{}, err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	client, err := HTTPClient(parsed.String())
	if err != nil {
		return Client{}, err
	}
	return Client{baseURL: parsed, client: client}, nil
}

func NewVerifiedClient(rawURL string, verify func() error) (Client, error) {
	client, err := NewClient(rawURL)
	if err != nil {
		return Client{}, err
	}
	client.client, err = VerifiedHTTPClient(client.BaseURL(), verify)
	return client, err
}

// NewClientFromChatCompletionsURL validates the endpoint persisted for the
// managed provider and recovers its loopback Ollama runtime root.
func NewClientFromChatCompletionsURL(rawURL string) (Client, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return Client{}, errors.New("invalid local Chat Completions URL")
	}
	const suffix = "/v1/chat/completions"
	if !strings.HasSuffix(parsed.Path, suffix) {
		return Client{}, errors.New("local Chat Completions URL must end in /v1/chat/completions")
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, suffix)
	return NewClient(parsed.String())
}

// BaseURL returns the runtime API root used by this client.
func (c Client) BaseURL() string {
	if c.baseURL == nil {
		return ""
	}
	return c.baseURL.String()
}

// ChatCompletionsURL returns the corresponding OpenAI-compatible endpoint.
func (c Client) ChatCompletionsURL() string {
	return c.endpoint("/v1/chat/completions")
}

// Embed uses Ollama's native embedding endpoint on the same loopback-only
// runtime. Explicitly disable truncation so indexing never silently drops the
// end of a saved note.
func (c Client) Embed(ctx context.Context, model string, input []string) ([][]float32, error) {
	if strings.TrimSpace(model) == "" || len(input) == 0 || len(input) > 32 {
		return nil, errors.New("invalid local embedding request")
	}
	payload, err := json.Marshal(struct {
		Model    string   `json:"model"`
		Input    []string `json:"input"`
		Truncate bool     `json:"truncate"`
	}{model, input, false})
	if err != nil {
		return nil, err
	}
	request, err := c.request(ctx, http.MethodPost, "/api/embed", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("connect to local Ollama embeddings: %w", err)
	}
	defer response.Body.Close()
	if err := requireSuccess(response, "generate local embeddings"); err != nil {
		return nil, err
	}
	var result struct {
		Embeddings [][]float32 `json:"embeddings"`
	}
	if err := decodeBounded(response.Body, &result); err != nil {
		return nil, err
	}
	if len(result.Embeddings) != len(input) {
		return nil, errors.New("local embedding count mismatch")
	}
	return result.Embeddings, nil
}

// Version verifies that the selected local runtime is reachable.
func (c Client) Version(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := c.request(ctx, http.MethodGet, "/api/version", nil)
	if err != nil {
		return "", err
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return "", fmt.Errorf("connect to local Ollama runtime: %w", err)
	}
	defer response.Body.Close()
	if err := requireSuccess(response, "read local Ollama version"); err != nil {
		return "", err
	}
	var payload struct {
		Version string `json:"version"`
	}
	if err := decodeBounded(response.Body, &payload); err != nil {
		return "", fmt.Errorf("decode local Ollama version: %w", err)
	}
	if strings.TrimSpace(payload.Version) == "" || len(payload.Version) > 128 || strings.ContainsAny(payload.Version, "\r\n") {
		return "", errors.New("local Ollama runtime returned an empty version")
	}
	return payload.Version, nil
}

// Models lists models installed in the selected local runtime.
func (c Client) Models(ctx context.Context) ([]InstalledModel, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := c.request(ctx, http.MethodGet, "/api/tags", nil)
	if err != nil {
		return nil, err
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("connect to local Ollama runtime: %w", err)
	}
	defer response.Body.Close()
	if err := requireSuccess(response, "list local Ollama models"); err != nil {
		return nil, err
	}
	var payload struct {
		Models []struct {
			Name   string `json:"name"`
			Size   *int64 `json:"size"`
			Digest string `json:"digest"`
		} `json:"models"`
	}
	if err := decodeBounded(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode local Ollama models: %w", err)
	}
	if payload.Models == nil {
		return nil, errors.New("local model inventory missing")
	}
	if len(payload.Models) > 256 {
		return nil, errors.New("installed inventory exceeds limit")
	}
	models := make([]InstalledModel, 0, len(payload.Models))
	seen := make(map[string]struct{}, len(payload.Models))
	for _, item := range payload.Models {
		name := strings.TrimSpace(item.Name)
		if name == "" || len(name) > 512 || strings.ContainsAny(name, "\r\n") {
			return nil, errors.New("invalid installed model identity")
		}
		if _, found := seen[name]; found {
			continue
		}
		seen[name] = struct{}{}
		if item.Size != nil && *item.Size < 0 || len(item.Digest) > 128 || strings.ContainsAny(item.Digest, "\r\n") {
			return nil, errors.New("invalid local model metadata")
		}
		entry := InstalledModel{Name: name, Digest: item.Digest}
		if item.Size != nil {
			entry.Size = *item.Size
			entry.SizeKnown = true
		}
		models = append(models, entry)
	}
	return models, nil
}

// Pull downloads one curated model and exposes bounded local progress. Ollama
// resumes interrupted pulls itself; Hot Cross Buns never sends an insecure-pull flag.
func (c Client) Pull(ctx context.Context, model Model, progress func(Progress)) error {
	payload, err := json.Marshal(struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}{Model: model.OllamaModel, Stream: true})
	if err != nil {
		return err
	}
	request, err := c.request(ctx, http.MethodPost, "/api/pull", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient().Do(request)
	if err != nil {
		return fmt.Errorf("connect to local Ollama runtime: %w", err)
	}
	defer response.Body.Close()
	if err := requireSuccess(response, "download local model"); err != nil {
		return err
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1024), maxProgressBytes)
	sawSuccess := false
	records := 0
	previous := make(map[string]int64)
	for scanner.Scan() {
		records++
		if records > 100000 {
			return errors.New("download progress exceeds record limit")
		}
		var update struct {
			Status    string `json:"status"`
			Digest    string `json:"digest"`
			Completed int64  `json:"completed"`
			Total     int64  `json:"total"`
			Error     string `json:"error"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &update); err != nil {
			return fmt.Errorf("decode local model download progress: %w", err)
		}
		if strings.TrimSpace(update.Error) != "" {
			return errors.New("local runtime reported a model download failure")
		}
		if update.Completed < 0 || update.Total < 0 || update.Total > 0 && update.Completed > update.Total || len(update.Status) > 512 || len(update.Digest) > 128 || sawSuccess {
			return errors.New("invalid local download progress")
		}
		if update.Digest != "" {
			if len(previous) > 256 || update.Completed < previous[update.Digest] {
				return errors.New("invalid download progress sequence")
			}
			previous[update.Digest] = update.Completed
		}
		if strings.EqualFold(strings.TrimSpace(update.Status), "success") {
			sawSuccess = true
		}
		if progress != nil {
			progress(Progress{Status: strings.TrimSpace(update.Status), Digest: strings.TrimSpace(update.Digest), Completed: update.Completed, Total: update.Total})
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read local model download progress: %w", err)
	}
	if !sawSuccess {
		return errors.New("local model download ended without a success status")
	}
	return nil
}

// Remove deletes one curated model from the selected local runtime.
func (c Client) Remove(ctx context.Context, model Model) error {
	payload, err := json.Marshal(struct {
		Model string `json:"model"`
	}{Model: model.OllamaModel})
	if err != nil {
		return err
	}
	request, err := c.request(ctx, http.MethodDelete, "/api/delete", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient().Do(request)
	if err != nil {
		return fmt.Errorf("connect to local Ollama runtime: %w", err)
	}
	defer response.Body.Close()
	return requireSuccess(response, "remove local model")
}

func (c Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	if c.baseURL == nil {
		return nil, errors.New("local runtime URL is not configured")
	}
	return http.NewRequestWithContext(ctx, method, c.endpoint(path), body)
}

func (c Client) endpoint(path string) string {
	endpoint := *c.baseURL
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + path
	return endpoint.String()
}

func (c Client) httpClient() *http.Client {
	if c.client != nil {
		return c.client
	}
	return &http.Client{Timeout: time.Second, Transport: rejectLocalTransport{}}
}

func decodeBounded(source io.Reader, target any) error {
	contents, err := io.ReadAll(io.LimitReader(source, maxResponseBytes+1))
	if err != nil {
		return errors.New("read local response failed")
	}
	if len(contents) > maxResponseBytes {
		return errors.New("local response exceeds limit")
	}
	if err := json.Unmarshal(contents, target); err != nil {
		return errors.New("invalid local JSON response")
	}
	return nil
}

func requireSuccess(response *http.Response, action string) error {
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		return nil
	}
	return fmt.Errorf("%s: local Ollama runtime returned HTTP %d", action, response.StatusCode)
}

type rejectLocalTransport struct{}

func (rejectLocalTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("local transport is not configured")
}

// Running inspects loaded weights; this GET does not load or unload a model.
func (c Client) Running(ctx context.Context) ([]InstalledModel, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := c.request(ctx, http.MethodGet, "/api/ps", nil)
	if err != nil {
		return nil, err
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, errors.New("loaded model inspection unavailable")
	}
	defer response.Body.Close()
	if err := requireSuccess(response, "inspect loaded models"); err != nil {
		return nil, err
	}
	var payload struct {
		Models []struct {
			ContextLength int    `json:"context_length"`
			Name          string `json:"name"`
			Size          *int64 `json:"size"`
			Digest        string `json:"digest"`
		} `json:"models"`
	}
	if err := decodeBounded(response.Body, &payload); err != nil {
		return nil, err
	}
	if payload.Models == nil {
		return nil, errors.New("local model inventory missing")
	}
	if len(payload.Models) > 256 {
		return nil, errors.New("loaded inventory exceeds limit")
	}
	result := make([]InstalledModel, 0, len(payload.Models))
	for _, m := range payload.Models {
		if m.Name == "" || len(m.Name) > 512 || len(m.Digest) > 128 || m.Size != nil && *m.Size < 0 || strings.ContainsAny(m.Name+m.Digest, "\r\n") {
			return nil, errors.New("invalid loaded model metadata")
		}
		if m.ContextLength < 0 || m.ContextLength > 4*1024*1024 {
			return nil, errors.New("invalid loaded context length")
		}
		entry := InstalledModel{Name: m.Name, Digest: m.Digest, ContextLength: m.ContextLength}
		if m.Size != nil {
			entry.Size = *m.Size
			entry.SizeKnown = true
		}
		result = append(result, entry)
	}
	return result, nil
}
