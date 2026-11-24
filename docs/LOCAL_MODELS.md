# Local models in the browser app

Run `make run`, then open **Models → Local models**. The current app can start a
separately owned Ollama process after reviewing the installed executable and its
SHA-256. It does not install Ollama automatically. Start, Stop and Download have
separate, expiring reviews; downloading does not select or run a model.

The controller uses a private profile-scoped model cache and a pinned loopback
TLS proxy for cooperating backend requests. The owned process remains available
after a browser or host disconnect so scheduled tasks can use it. Stop applies
to the process created by that controller and is blocked while requests are active.
Interrupted operations require inspection and are not automatically replayed.
See [runtime ownership and verification limits](WEB-ONLY-RUNTIME.md#local-runtime-controls).

Chat model selection and memory embeddings are separate. See
[Knowledge](KNOWLEDGE.md) and [Conversation continuity](CONVERSATION-CONTINUITY.md)
for retrieval settings, upload permissions and fallback behavior.

## Historical terminal implementation

The following record describes the retired Work TUI, including its installer,
shortcuts, cache layout and shutdown behavior. It is retained as historical
evidence, not instructions for the current browser app. Its model inventory and
verification results apply to that checkpoint only.

### Local models in the Work TUI

Start `hot-cross-buns`, enter `/model`, then choose **Local model**. The first screen
always asks whether you want a **Cloud API key** or **Local model**; the same
screen is available from the command palette and first-run model selection. All
local model management happens here; the former `hot-cross-buns local` CLI commands are
retired and return directions to this screen. Automation and headless Work can
still use the persisted model selection.

Hot Cross Buns uses the existing Ollama runtime and its loopback Chat Completions API.
Its Work service, tools, specialist boundaries, evidence, and approvals still
own execution. General Work models are listed before coding models so the
catalog reflects Hot Cross Buns's research, analysis, and deliverable workflows as well
as implementation work. The catalog is text-only: direct image prompt inputs
are reported explicitly, while PDF prompt attachments and frozen source PDFs
use Hot Cross Buns's bounded native text extraction. Scanned pages are flagged as
requiring OCR rather than silently treated as empty. No model-quality claim
follows from being in the catalog.

Memory recall uses a separate Ollama embedding model. Check it with `hot-cross-buns
memory embeddings status` and explicitly download `embeddinggemma:latest`
(about 622 MB) with `hot-cross-buns memory embeddings install --yes`. This model does
not replace the selected Work chat model. See [Personal knowledge and
skills](KNOWLEDGE.md) for the separate cloud embedding opt-in and lexical
fallback.

The saved selection also applies to goal-linked recurring jobs that use the
default provider when they run. A live evaluation can select it explicitly with
`--provider hot-cross-buns-local --model MODEL_TAG`; see the
[continuity benchmark](PERSONAL_CONTINUITY_BENCHMARK.md#local-model-comparison).
The managed local provider disables browser sessions, so tasks that need a
browser require a different provider.

## Download, select, and removal status

1. Choose a model with ↑/↓. The screen shows installed state, source, approximate
   size, and host eligibility.
2. Press `p` to review its download source and size, then Enter or `y` to confirm.
   Progress appears while the UI remains responsive. Esc or Ctrl+C requests
   cancellation; a later pull uses Ollama's resumable download behavior.
3. Press `u` or Enter to select an installed model. The selection is saved for
   the next Work run and later sessions. Press `e` to edit its display name.
4. Model deletion is currently blocked, including after the `x` confirmation.
   The backend reports that cross-process use leases and durable mutation receipts
   are not implemented. It sends no delete request and keeps the model and saved
   selection. Model files may also be used by other clients of the same runtime.
5. Press Esc to return to the same conversation or draft. First-run setup keeps
   the pending prompt in the composer; press Enter to start it after selection.

`r` refreshes inventory, `i` opens prerequisite help, and F1 shows shortcuts.
Model management waits until active Work in its execution owner has finished or
been cancelled. Downloads require their own TUI confirmation. That confirmation
does not grant model-deletion authority.

## Runtime setup

If Ollama is installed but stopped, the Local screen offers **Start with Hot Cross Buns**.
Enter or `y` starts `ollama serve` as a child of the Work TUI. It remains running
when the model screen closes and stops when Hot Cross Buns exits. Hot Cross Buns does not adopt or
stop a runtime that was already running. Press `s` to revisit runtime startup.
Closing the TUI cancels a pending model operation.

If the Ollama executable is missing, the screen offers installation help with the
[official download source](https://ollama.com/download) and platform guidance.
On Linux, Enter first shows the exact official `curl -fsSL
https://ollama.com/install.sh | sh` action, then requires a second confirmation
before it runs. When elevation is needed, Hot Cross Buns asks for the system password in
the same terminal once, then returns to the TUI and streams bounded installer
output while the download runs. On macOS, Hot Cross Buns opens Ollama's official download
page so the system installer remains visible to you. Hot Cross Buns does not guess
distribution package-manager commands.
Once installed, refresh from the Local screen; model downloads, selection,
and runtime startup require no separate Hot Cross Buns CLI commands.

## Cloud and custom models

The initial model picker explains storage, retrieval, and chat processing
separately. Choosing a local embedding model does not change a cloud Work model's
processing destination. `/memory` exposes the independent retrieval setting,
readiness, and upload choice, and offers the local embedding download with
progress and Esc cancellation.

Choose **Cloud API key** from the first screen to configure a provider/model
with masked API-key entry and provider-specific endpoint fields, then press
`u`/Enter to select a model. The selection is persisted for Work. The screen
reports API-key/configuration readiness, not a live account entitlement check.
Hot Cross Buns does not use provider subscriptions, browser sign-in, vendor CLIs, or
external coding-agent harnesses for model access.

Press `n` to add a custom Chat Completions endpoint, `g` to preview model discovery,
`e` to rename an entry, `d` to remove a stored Hot Cross Buns credential, and `x` to remove a
custom provider. The reserved `hot-cross-buns-local` entry is managed from Local. This
screen is owned by the focused `internal/modelcatalog` component; it does not
reopen the historical Code composer or read/write its draft state. The legacy
`internal/tui` constructor is only a compatibility adapter to the same panel.

## Host eligibility guardrail

The Local model screen detects the operating system, architecture, total RAM, currently
available RAM where the platform reports it, and free space in the Ollama model
filesystem. It reports each reviewed model as enabled or disabled and explains
the exact blocking condition. Hot Cross Buns supports Linux and macOS on `amd64` and
`arm64`; an unrecognized OS or architecture is disabled rather than assumed
compatible.

The published pull size is the only stable per-model resource fact in this
catalog. Hot Cross Buns therefore uses a deliberately conservative admission policy,
not an upstream hardware claim: it requires twice that published size in both
physical RAM and (when measurable) currently available RAM, plus 20% free disk
headroom for the pull. The current catalog evaluates to:

| Hot Cross Buns ID | Hot Cross Buns RAM guardrail | Hot Cross Buns free-disk guardrail |
| --- | ---: | ---: |
| `qwen3-4b` | 4.7 GiB | 2.8 GiB |
| `qwen3-8b` | 9.7 GiB | 5.8 GiB |
| `llama3.1-8b` | 9.1 GiB | 5.5 GiB |
| `qwen3-30b` | 35.4 GiB | 21.2 GiB |
| `mistral-small3.2-24b` | 27.9 GiB | 16.8 GiB |
| `qwen2.5-coder-0.5b` | 759 MiB | 455 MiB |
| `qwen2.5-coder-1.5b` | 1.8 GiB | 1.1 GiB |
| `qwen2.5-coder-3b` | 3.5 GiB | 2.1 GiB |
| `qwen2.5-coder-7b` | 8.8 GiB | 5.3 GiB |
| `qwen2.5-coder-14b` | 16.8 GiB | 10.1 GiB |
| `qwen2.5-coder-32b` | 37.3 GiB | 22.4 GiB |
| `devstral-24b` | 26.1 GiB | 15.6 GiB |
| `qwen3-coder-30b` | 35.4 GiB | 21.2 GiB |

Hot Cross Buns blocks TUI download/selection and every
managed-local executor setup (including a previously selected model) when the
host fails this policy. Rename remains available; deletion stays blocked by the
separate cross-process ownership requirement. This is intentionally a capacity safety
check: it does not guarantee useful speed or full context support.

Hot Cross Buns uses `OLLAMA_MODELS` when it is present. Otherwise it follows Ollama's
documented default model storage location for the detected OS. If Ollama runs
as a Linux service, set `OLLAMA_MODELS` in that service's environment as well
as the invoking environment when using a non-default disk. See the
[Ollama FAQ](https://docs.ollama.com/faq) for model locations and service
environment setup.

GPU compatibility, available VRAM, context length, quantization, and parallel
requests are not safely derivable from a generic laptop inspection. Ollama
chooses its runtime backend; the model-management screen does not currently report CPU/GPU placement. Larger context and parallel requests can
raise memory use beyond Hot Cross Buns's guardrail, so keep them conservative on a
resource-constrained machine.

## Reviewed catalog

The Local screen presents General Work first, then Coding. The ordering is a
recommendation about the intended Hot Cross Buns workflow, not a model-quality ranking.

### General Work

| Hot Cross Buns ID | Ollama tag | Published package | Context | Intended use |
| --- | --- | ---: | ---: | --- |
| `qwen3-4b` | `qwen3:4b` | 2.5 GB | 256K | compact source synthesis, analysis, and writing |
| `qwen3-8b` | `qwen3:8b` | 5.2 GB | 40K | balanced research, analysis, and writing |
| `llama3.1-8b` | `llama3.1:8b` | 4.9 GB | 128K | long-source synthesis, multilingual writing, and tool use |
| `qwen3-30b` | `qwen3:30b` | 19 GB | 256K | long-context research and source synthesis |
| `mistral-small3.2-24b` | `mistral-small3.2:24b` | 15 GB | 128K | precise instruction following and tool-backed deliverables |

### Coding

| Hot Cross Buns ID | Ollama tag | Published package | Context | Intended use |
| --- | --- | --- | --- | --- |
| `qwen2.5-coder-0.5b` | `qwen2.5-coder:0.5b` | 398 MB | 32K | minimal coding option for constrained hardware |
| `qwen2.5-coder-1.5b` | `qwen2.5-coder:1.5b` | 986 MB | 32K | compact code-focused option for low-memory hosts |
| `qwen2.5-coder-3b` | `qwen2.5-coder:3b` | 1.9 GB | 32K | small code-focused option for everyday laptops |
| `qwen2.5-coder-7b` | `qwen2.5-coder:7b` | 4.7 GB | 32K | balanced code-focused option |
| `qwen2.5-coder-14b` | `qwen2.5-coder:14b` | 9.0 GB | 32K | larger code-focused option |
| `qwen2.5-coder-32b` | `qwen2.5-coder:32b` | 20 GB | 32K | largest Qwen2.5-Coder option for high-memory hosts |
| `devstral-24b` | `devstral:24b` | 14 GB | 128K | agentic coding with tool use |
| `qwen3-coder-30b` | `qwen3-coder:30b` | 19 GB | 256K | long-context agentic coding |

The catalog maps only to the linked [Qwen3](https://ollama.com/library/qwen3),
[Llama 3.1](https://ollama.com/library/llama3.1),
[Mistral Small 3.2](https://ollama.com/library/mistral-small3.2),
[Qwen2.5-Coder](https://ollama.com/library/qwen2.5-coder),
[Devstral](https://ollama.com/library/devstral), and
[Qwen3-Coder](https://ollama.com/library/qwen3-coder) packages. It is not a
live search of Hugging Face, and Hot Cross Buns does not clone, execute, or download
arbitrary model repositories. That keeps model provenance, package size, and
the tool-calling capability required by Hot Cross Buns's native loop reviewable in
source.

Package size is not a hardware guarantee: available RAM/VRAM or unified
memory, quantization, configured context, and other loaded applications affect
whether a model runs usefully. The Hot Cross Buns guardrail above protects against clear
capacity shortfalls, but cannot make a performance or benchmark claim for any
catalog entry. Review the upstream model card and license before downloading.

## Runtime boundary

The manager uses a loopback Ollama runtime. Selecting a model persists the
`hot-cross-buns-local` provider and its `/v1/chat/completions` endpoint. Existing configured
loopback endpoints remain readable; remote addresses are rejected. No API key is
stored or sent to the managed local runtime.

This restriction is deliberate. A remote or shared endpoint belongs to the
Cloud section’s custom-provider form (`n`), where its authentication and data-handling
contract can be declared explicitly. Hot Cross Buns never enables Ollama's
insecure pull option and never uploads models.

Ollama documents Chat Completions streaming and tool support, which is why the
catalog can retain Hot Cross Buns's tool loop rather than delegating to another harness.
Hot Cross Buns treats every managed local catalog model as text-only, including upstream
packages that separately advertise vision support, so do not use `--image` with
them. Text attachments retain the normal OpenAI-compatible provider behavior.
Hot Cross Buns converts selected PDFs to bounded page-marked text before calling a
text-only model; it does not send PDF bytes over the generic protocol.

## Verification of the Work TUI integration

September 11, 2026: after extracting the focused model-catalog boundary,
`GOTOOLCHAIN=go1.25.13 make check` passed all 54 packages, formatting, vet, and
build. Race checks passed for `internal/modelcatalog`, `internal/tui`,
`internal/worktui`, and `cmd/hot-cross-buns`. The race pass also found and corrected an
unsynchronized callback assertion in the historical terminal test harness.
Browser code did not change, so the Chromium integration was not repeated for
this change.

The assembled Bubble Tea test uses local HTTP fixtures to exercise download
confirmation, progress, cancellation, a completed download, persistent selection,
an actual Work-service artifact run, declined deletion, and refusal of confirmed
deletion while preserving the installed model and selection. Other regressions cover short-terminal
confirmations, preserving conversations and historical Code drafts, cancelled
refreshes, stale panel responses, active-run exclusion and runtime shutdown.
An initial race run exposed test synchronization against streamed text rather
than terminal completion; the corrected test passed three race-enabled repeats
and the final full race group. The initial UI text assertion was also updated to
the actual confirmation label before passing verification.

A separate real-terminal smoke check started the installed Ollama executable
from Work, listed installed models, selected `qwen2.5-coder:0.5b`, and cancelled a
live Work task. Its retained manifest reports four requests, 8,861 input tokens,
130 output tokens, and no completed artifact before cancellation on turn four.
The Ollama server and runner were absent after Hot Cross Buns exited. This verifies the
runtime lifecycle and cancellation, not successful live task quality. No existing
model weights were downloaded or deleted in that smoke check; those operations
were verified with local HTTP fixtures.

## Recovery, usage, and data controls

[Recovery, shared usage, and private data](RECOVERY_USAGE_DATA.md) documents
/recovery, /usage, /data, their CLI equivalents, conservative defaults, and
verification limits.
