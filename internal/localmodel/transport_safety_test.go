package localmodel

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalTransportRedirectsAndProxyIsolation(t *testing.T) {
	var proxyCalls atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls.Add(1)
		t.Error("proxy received local traffic")
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("ALL_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	for _, code := range []int{301, 302, 307, 308} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", "http://off-host.invalid/INERT_SECRET")
				w.WriteHeader(code)
			}))
			defer server.Close()
			c, _ := NewClient(server.URL)
			for _, operation := range []func() error{
				func() error { _, err := c.Version(context.Background()); return err }, func() error { _, err := c.Models(context.Background()); return err }, func() error { _, err := c.Running(context.Background()); return err },
				func() error { return c.Pull(context.Background(), Model{OllamaModel: "fixture"}, nil) }, func() error { return c.Remove(context.Background(), Model{OllamaModel: "fixture"}) }, func() error { _, err := c.Embed(context.Background(), "fixture", []string{"inert"}); return err },
			} {
				if err := operation(); err == nil || strings.Contains(err.Error(), "INERT_SECRET") {
					t.Fatal("unsafe redirect", err)
				}
			}
			client, _ := HTTPClient(server.URL)
			response, err := client.Post(server.URL+"/v1/chat/completions", "application/json", strings.NewReader(`{}`))
			if response != nil {
				response.Body.Close()
			}
			if err == nil || strings.Contains(err.Error(), "INERT_SECRET") {
				t.Fatal("inference redirect", err)
			}
		})
	}
	if proxyCalls.Load() != 0 {
		t.Fatal("proxy escape")
	}
}
func TestLocalTransportURLAndRequestBoundary(t *testing.T) {
	for _, url := range []string{"http://localhost.evil:80", "http://2130706433", "http://127.1", "http://[::1%25lo0]:80", "http://secret@127.0.0.1", "http://127.0.0.1?api_key=secret", "http://127.0.0.1#secret", "http://127.0.0.1:0", "https://127.0.0.1", "http://0.0.0.0"} {
		if _, err := NewClient(url); err == nil {
			t.Fatal("accepted", url)
		}
	}
	u, err := LocalURL("http://localhost.:11434")
	if err != nil || u.Hostname() != "127.0.0.1" {
		t.Fatal("localhost must not use DNS", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("credential request reached listener") }))
	defer server.Close()
	client, _ := HTTPClient(server.URL)
	r, _ := http.NewRequest("GET", server.URL, nil)
	r.Header.Set("Authorization", "inert")
	if _, err := client.Do(r); err == nil {
		t.Fatal("credential header accepted")
	}
}
func TestLocalResponsesBoundsCancellationAndMalformedProgress(t *testing.T) {
	for _, body := range []string{`{"version":"ok"}` + strings.Repeat(" ", maxResponseBytes), `{"version":`, `{"version":"ok"} {}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		c, _ := NewClient(server.URL)
		_, err := c.Version(context.Background())
		server.Close()
		if err == nil {
			t.Fatal("malformed/oversized response accepted")
		}
	}
	for _, body := range []string{`{"completed":-1}`, `{"completed":11,"total":10}`, `{"status":"success"}` + "\n" + `{"status":"more"}`, `{"status":`, strings.Repeat("x", maxProgressBytes+1), `{"error":"FIXTURE_SECRET"}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		c, _ := NewClient(server.URL)
		err := c.Pull(context.Background(), Model{OllamaModel: "fixture"}, nil)
		server.Close()
		if err == nil || strings.Contains(err.Error(), "FIXTURE_SECRET") {
			t.Fatal("invalid/unsafe progress", err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	c, _ := NewClient(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := c.Models(ctx); err == nil || time.Since(start) > time.Second {
		t.Fatal("cancellation not bounded", err)
	}
}
