# Custom providers and local endpoints

**Interface status:** Hot Cross Buns is a desktop app. Shell examples below are source-checkout developer operations with an explicit internal opt-in; see [development instructions](DEVELOPMENT.md). They do not install or enable a public CLI.

For Hot Cross Buns's reviewed Ollama Work and coding-model catalog, use the **Local**
section of [`/model`](LOCAL_MODELS.md). It downloads a selected package with
explicit confirmation and binds it to every native Hot Cross Buns interface without
manually entering an endpoint. This document covers the separate path for a
local server or compatible endpoint that you operate yourself.

Hot Cross Buns's custom-provider path is for an OpenAI-compatible Chat Completions
endpoint that you operate or have independently documented. It keeps Hot Cross Buns's
native agent loop, worktree flow, tools, verification, sessions, and RPC
protocol; only the inference endpoint changes.

Create the provider once:

```sh
# A manually operated Ollama, LM Studio, or vLLM endpoint.
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider add local-llm \
  --base-url http://127.0.0.1:11434/v1/chat/completions \
  --model qwen3-coder

# A compatible endpoint that requires a key held in the process environment.
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider add team-gateway \
  --base-url https://models.example.com/v1/chat/completions \
  --api-key-env TEAM_GATEWAY_API_KEY \
  --model coding-large --model coding-small
```

The first `--model` is the default; subsequent model flags add selectable
models. Use the configured ID everywhere a built-in provider would appear:

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work --provider local-llm 'Summarize the current project and open questions'
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns config set default-provider local-llm
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider list
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider discover local-llm
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider discover local-llm --apply
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns provider remove local-llm --yes
```

The terminal picker and JSONL RPC validate the same catalog. In `/model`, `n`
creates a custom provider, `c` on a custom row edits it, `g` previews the
sibling `/models` catalog as untrusted server data, and `x` removes endpoint
metadata after confirmation. A custom provider
does not receive PDF bytes because the generic Chat Completions protocol has no
stable document-input format; Hot Cross Buns converts selected PDFs to bounded,
page-marked text first. Image-only pages are explicitly marked as needing OCR.
Hot Cross Buns persists endpoint metadata and model IDs in `config.json`, never API keys.
A keyless endpoint sends no `Authorization`
header; a keyed endpoint reads exactly the named environment variable at run
start. Removing a provider does not unset that environment variable.

`discover` requests the standard sibling `/models` endpoint derived from a
base URL ending in `/chat/completions`. Off-origin redirects are rejected. It
prints discovered IDs first; `--apply` or the TUI confirmation is the explicit
step that replaces the persisted model catalog. The
existing default is retained when still present, otherwise Hot Cross Buns selects the
first discovered ID. Removing a provider also clears defaults and display
aliases that pointed at it.
