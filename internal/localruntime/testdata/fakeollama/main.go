// An inert Ollama-shaped process for lifecycle tests. It never fetches weights.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func main() {
	if len(os.Args) != 2 || os.Args[1] != "serve" {
		os.Exit(2)
	}
	directory := os.Getenv("OLLAMA_MODELS")
	if directory == "" {
		os.Exit(2)
	}
	_ = os.MkdirAll(directory, 0700)
	_ = os.WriteFile(filepath.Join(directory, "launched.json"), []byte(fmt.Sprintf(`{"pid":%d,"cloud":%q,"secret":%q}`, os.Getpid(), os.Getenv("OLLAMA_NO_CLOUD"), os.Getenv("HCB_TEST_SECRET"))), 0600)
	var mu sync.Mutex
	installed := map[string]bool{}
	hold := func(r *http.Request, name string) bool {
		for {
			if _, err := os.Stat(filepath.Join(directory, name)); os.IsNotExist(err) {
				return true
			}
			select {
			case <-r.Context().Done():
				return false
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	server := &http.Server{Addr: os.Getenv("OLLAMA_HOST"), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/version":
			fmt.Fprint(w, `{"version":"fixture"}`)
		case "/api/tags":
			mu.Lock()
			defer mu.Unlock()
			models := []any{}
			for tag := range installed {
				models = append(models, map[string]any{"name": tag, "digest": strings.Repeat("a", 64), "size": 100})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"models": models})
		case "/api/ps":
			fmt.Fprint(w, `{"models":[]}`)
		case "/api/pull":
			var input struct {
				Model string `json:"model"`
				Name  string `json:"name"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input.Model == "" {
				input.Model = input.Name
			}
			_ = os.WriteFile(filepath.Join(directory, "pull.json"), []byte(input.Model), 0600)
			fmt.Fprintln(w, `{"status":"pulling fixture","total":100,"completed":25}`)
			w.(http.Flusher).Flush()
			if !hold(r, "slow-pull") {
				return
			}
			mu.Lock()
			installed[input.Model] = true
			mu.Unlock()
			fmt.Fprintln(w, `{"status":"success","total":100,"completed":100}`)
		case "/v1/chat/completions":
			_ = os.WriteFile(filepath.Join(directory, "inference"), []byte("started"), 0600)
			if !hold(r, "hold") {
				return
			}
			fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"fixture"},"finish_reason":"stop"}]}`)
		default:
			http.NotFound(w, r)
		}
	})}
	if server.ListenAndServe() != nil {
		os.Exit(1)
	}
}
