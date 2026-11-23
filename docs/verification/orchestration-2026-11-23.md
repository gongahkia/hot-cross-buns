# Live app and local-agent verification — 23 November 2026

The normal browser app at `http://127.0.0.1:4317` uses OpenAI / `gpt-5-mini`.
The existing key was saved through the app's reviewed provider API into its
private credential store, not committed or copied into browser code. A real
browser conversation returned `Hello!` to a synthetic greeting.

OpenCode and GitHub Copilot are enabled in this machine's normal app profile,
with `gpt-5-mini`, a 120-second invocation timeout and private patch creation.
This is local configuration, not a new repository-wide default. Codex and
Gemini remain disabled. Opening Delegated work does not launch a worker.

A normal-app smoke test after the runtime correction also started and awaited
both local workers through the browser gateway. Their durable task records
confirm `completed` with `opencode ready` and `copilot ready`, using the app-stored
key without an `OPENAI_API_KEY` service variable.

Compact machine-readable results are retained [alongside this report](orchestration-2026-11-23.json).

## Live results

| Check | Result |
| --- | --- |
| Actual browser chat using the app-stored OpenAI key | Passed |
| Normal browser gateway → OpenCode and Copilot, using app credentials | Passed, both durable tasks completed |
| OpenAI manager → OpenCode, then a continuation with retained result context | Passed, 5/5 checks |
| OpenAI manager → Copilot, then a continuation with retained result context | Passed, 5/5 checks |
| OpenCode scoped Python repair, independent offline assertions | Passed, 4/4 checks |
| Copilot scoped Python repair, independent offline assertions | Passed, 4/4 checks |
| OpenAI manager → OpenCode context handoff → coding patch → backend verification | Passed, 8/8 checks |
| OpenAI manager → Copilot context handoff → coding patch → backend verification | Failed; patch verified, but manager omitted the continuation field and reached its step limit |
| Codex provider access | Blocked by the OpenAI organization's Codex BYOK restriction |
| Gemini CLI live access | Not run, by user instruction; no Gemini credential configured |
| Personal-assistant lifecycle | 12/14 checks passed; two dependency-related failures |

The handoff fixture checked the owner `Mira`, deadline `2030-05-16` and a unique
marker. The manager started and awaited two workers; the second assignment used
the first task ID and the host supplied its retained result as untrusted context.
OpenCode and Copilot start fresh processes: **this is explicit result handoff,
not native session resumption**, live steering, or hidden conversation carryover.

The coding fixture corrected subtraction to addition in `calculator.py`. Each
worker could modify only that file in its private checkout. The host applied the
returned patch to a separate verification copy and checked positive, negative
and zero inputs with network access denied. The original source stayed unchanged.

The combined Copilot coding run retained a valid patch and passed the backend
verifier, but failed the overall test. Its manager wrote `continue=subagent-001`
inside the assignment text instead of supplying the tool's `continue` argument.
Consequently the host supplied no retained context, and the worker reported that
the owner/deadline/marker were unavailable. The manager also reached its 12-step
limit. The separate Copilot handoff run did use the argument and passed. This
is an unresolved orchestration reliability limitation, not evidence that context
was successfully handed off in the failed coding run.

## Personal-assistant coverage and failures

The live `TestLiveInternalAgentLifecycle` run used synthetic notes and a local
goal. It verified updating an existing note without duplicates, preserving
provenance, scheduling the exact existing step, recalling a corrected date in a
fresh chat, read-only agenda queries, completing only the reported step, and
quiet-versus-overdue decisions with exact pending-step evidence.

Two checks failed:

- `dependency preserved on original step`
- `agenda reports dependency and overlap`

In the dependency phase, the model proposed a time/status update but omitted the
requested `depends_on` field. The later agenda consequently had no dependency
to report. The response also suggested a retired CLI acceptance command. These
are unresolved live model/interaction failures; passing deterministic checks does
not establish reliable dependency planning. The test and its assertions remain
unchanged.

This run did not exercise real email, calendars, messaging, purchases or bookings.
No real-account external actions were sent. These checks are acceptance examples,
not a general personal-assistant capability benchmark.

## Blockers

Codex 0.171.0 reached the official API after the DNS correction. The server
rejected this organization with `codex_byok_restricted_by_api_credit_promo`.
Billing and credentials were left unchanged. Codex's live orchestration, coding
and native-session handoff therefore remain unverified with this account.

Gemini CLI 0.64.0 is installed. Its headless adapter has deterministic protocol
and sandbox tests, but live authentication and execution remain unverified.
The user explicitly chose to leave that live test blocked.

## Engineering changes

- Added bounded headless adapters for OpenCode, Gemini CLI and GitHub Copilot.
  Tested live versions: OpenCode 2.3.2 and Copilot 1.0.114. Copilot used OpenAI
  BYOK, not a GitHub subscription or imported login.
- Foreground adapters can resolve the matching app-stored provider key when the
  selected standard environment variable is absent. Invocation credentials are
  transient, redacted from errors and rejected in retained patches.
- Preserved the outer strict sandbox, finite read/edit tool lists, private HOME,
  disabled plugin/MCP discovery and revision/patch verification boundaries.
- Corrected Linux networked sandbox DNS: `/etc/resolv.conf` pointed outside
  `/etc` into systemd-resolved's runtime directory. Only the resolved file is
  mounted read-only; the surrounding `/run` directory remains hidden. Offline
  sandboxes do not receive this extra mount.
- Corrected runtime root filtering for trimmed Go binaries with an empty
  `GOROOT`. Cleaning that empty value produced `.` and an invalid current-directory
  mount; the real app's workers failed before startup with Bubblewrap's
  `Can't create file /bin: Read-only file system`. Empty and relative runtime
  roots are now excluded, with a regression test.
- Limited sandboxed Go parallelism to at most two CPUs to reduce memory
  pressure from fresh verifier builds. Earlier verifier attempts were
  killed while compiling; the sandbox had discarded the parent concurrency limit.
- Added shared brand mappings and the licensed Copilot PNG for task traces.

## Reproduction

With the selected provider keys available in the process environment, run each
paid probe explicitly; these are not part of ordinary `make check`:

```sh
go run ./scripts/cli-agent-eval --kind opencode --executable /absolute/path/to/opencode --model gpt-5-mini --handoff
go run ./scripts/cli-agent-eval --kind copilot --executable /absolute/path/to/copilot --model gpt-5-mini --handoff
go run ./scripts/cli-agent-eval --kind opencode --executable /absolute/path/to/opencode --model gpt-5-mini --coding
go run ./scripts/cli-agent-eval --kind copilot --executable /absolute/path/to/copilot --model gpt-5-mini --coding
go run ./scripts/cli-agent-eval --kind opencode --executable /absolute/path/to/opencode --model gpt-5-mini --handoff --coding
go run ./scripts/cli-agent-eval --kind copilot --executable /absolute/path/to/copilot --model gpt-5-mini --handoff --coding
HOT_CROSS_BUNS_LIVE_MODEL=gpt-5-mini HOT_CROSS_BUNS_LIVE_INTERNAL_REPORT=/absolute/path/to/new-report.json go test ./cmd/hot-cross-buns -run '^TestLiveInternalAgentLifecycle$' -count=1 -v -timeout 11m
```

Local detailed synthetic reports, redacted logs and the browser screenshot are
under `/var/tmp/hcb-orchestration-check/`; they are not repository fixtures and
may be removed by machine cleanup. A clean checkout still needs its own key,
installed tools and explicit adapter setup.

## Final automated checks

`TMPDIR=/var/tmp GOMAXPROCS=1 GOFLAGS=-p=1 GOMEMLIMIT=768MiB make check`
passed after the final fixes: Go tests, Go vet, 72 browser tests, 140 host tests
and one OAuth build test. The paid live probes remain separate from this suite;
their failures and exclusions above still apply.

An intermediate run terminated with `Killed`. A subsequent one-CPU run exposed
an existing installer-progress race: `Wait` closed stdout/stderr before their
readers drained them. The unchanged progress test failed 20/20 before the
ordering correction and passed 20/20 afterward:

```sh
GOMAXPROCS=1 go test -p=1 ./cmd/hot-cross-buns -run '^TestStreamOllamaInstallerReportsOutputInProgressOrder$' -count=20
```

The final suite ran without concurrent paid probes. No assertions were relaxed.
