# Harness hardening — 27 November 2026

HCB keeps its provider-neutral Go harness. These changes add runtime contracts
and verification without another frontend surface or an Agents SDK dependency.

## Implemented boundaries

| Area | Behavior | Verification |
| --- | --- | --- |
| Connected traces | A host-assigned workflow correlates conversation routing, context retrieval, Work execution, approvals and specialist events. OTLP adds bounded outcomes, attempts, usage and HTTP status without prompts, arguments, credentials or raw errors. Correlation grants no authority. | `internal/telemetry/telemetry_test.go`; conversation/Work tests |
| Structured decisions | Routing and plan preparation use one typed decoding/validation path. Duplicate keys, trailing JSON, unknown fields, invalid UTF-8, oversized output and unexpected tool calls are rejected. Routes allow one repair; plan preparation retains its one-request, tool-free invariant. Workers return a host-generated completion envelope with status, bounded summary, evidence references and blockers. | `internal/agent/structured_test.go`; planner, routing and orchestration tests |
| Durable checkpoints | Normal Work execution writes private, checksummed, atomically replaced checkpoints. The runner supports explicit pause/resume at a completed turn boundary. Task/system/tool/model configuration, scope, original step budget, usage and deadline constrain resume. A process lease excludes concurrent owners. The host must revalidate resources and authority. | `internal/agent/checkpoint_test.go`; Work integration and lifecycle tests |
| Host policies | Trusted rules can allow, block, require host approval, redact or require final verification. Input, model output, tool arguments, tool output and final output have common boundaries. Redaction precedes replay/events/post-tool hooks and clears opaque provider state or visual continuations where needed. Existing tool permissions and approvals remain mandatory. | `internal/agent/policy_test.go`; `internal/orchestrator/policy_test.go` |
| Tool efficiency | Large normal app tool inventories expose common tools immediately and discover other host-permitted tools on demand. Guessed hidden tools do not execute. Up to four consecutive vetted frozen-source reads can overlap; approvals, policies, hooks, result publication and mutations remain ordered. Steering drains after an already-started read batch and before the next action. | `internal/agent/discovery_test.go`; `internal/agent/parallel_test.go`; `internal/workrun/tool_execution_test.go`; scheduling gateway tests |
| Conformance | One HTTP matrix exercises Responses, Messages, Gemini, native-schema Chat Completions, local-compatible fallback and Radius. It checks structured repair, tool correlation, transient retry, domain denial, cancellation and steering. Streaming families also reject incomplete streams without replaying visible output. Existing CLI subprocess/native-session tests cover their distinct protocols. | `internal/model/harness_conformance_test.go`; `internal/cliagent/*_test.go`; full gateway/host tests |

## Output formats

Responses uses `text.format`, Anthropic uses `output_config.format`, and Gemini
uses `generationConfig.responseMimeType/responseJsonSchema`. Compatible Chat
Completions endpoints require explicit host selection of `NativeStructured`;
other compatible endpoints and Radius receive schema instructions and the same
local typed decoder and host semantic validator. This is not a general-purpose
JSON Schema implementation. Native schema rejection is surfaced rather than
silently changing providers or discarding the contract.

Provider references:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Google GenAI schema configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html)

A worker's `completed` envelope describes its execution outcome. It does not
prove every claim in its prose. Artifact, code, desktop and external-action
verification continue to use their existing concrete checks and receipts.
The main Work envelope is finalized after persistence and deferred operations,
so a failure after the model finishes is reported as partial/failed execution.

## Recovery constraints

Checkpoint state is local to the original execution scope. A `ready` checkpoint
can resume only through `RunOptions.Checkpoint` with explicit `Resume` and a
trusted `Revalidate` callback. The host scope must bind original resource/account
identities, permissions, policy revision and workspace. Checkpoints cannot grant
permissions or restore an approval token.

A checkpoint with an in-flight model/tool request, a completed run, omitted visual
input, changed scope, changed budget or a widened/expired deadline is rejected.
There is intentionally no automatic retry of an uncertain effect. Text-only
ready checkpoints retain correlated tool results, so a resume need not rerun
completed calls. A shared parent budget cannot be reconstituted from one child's
checkpoint; that case requires the parent owner to reconcile it.

The application continues to use its existing explicit, reviewed request-recovery
flow. The new runner resume API does not silently reopen a sealed Work workspace,
restore native CLI processes or replace receipt-based reconciliation. Work
checkpoint capture is active; selecting same-run resume remains a trusted host
operation rather than a new user-facing retry mode.

Checkpoint files are private `0600` data under `hot-cross-buns/checkpoints`.
Screenshots/attachments are omitted and make the checkpoint non-resumable.
History deletion and retention cover these files. Backups exclude them because
another device must not inherit executable run state.

## Policy and concurrency constraints

Host policies require an explicit revision when installed on a Work executor.
Unknown policy actions, rule failures and missing approval handlers fail closed.
Configured output policies or completion verification buffer streamed text until
validation. Without those checks, ordinary streaming stays incremental. Hosted CLI workers receive input and
summary policies; their internal commands retain their native permission and
sandbox brokers, rather than pretending to be individual Go tool calls.

Discovery searches only the inventory already filtered for the current task.
Reviewed plans keep their existing explicit tool surface. The common app update
interface stays immediately available, including scheduling and its exact-action
approval flow. Discovery itself does not count as a write for recovery.

Only `read_file`, `list_files` and `search_files` aimed at the frozen `source`
mount are enabled for parallel execution in Work. Live filesystem access,
connectors, network calls, local workers, discovery and mutations remain
sequential. Hooks and retained messages never run concurrently. A partial stream
is not retried merely because its provider later fails.

## Verification

Verification completed on this host:

- `make check` passed: all Go packages, `go vet ./...`, 206 browser-gateway tests,
  148 host tests and the OAuth build test. These gateway tests run the actual Go
  runtime with isolated local provider fixtures; they are not manual browser
  visual checks.
- Final `go test -race` passed for `internal/agent`, `internal/model`,
  `internal/orchestrator`, `internal/workrun` and `internal/telemetry`.
- The final runtime build passed. Focused permission, scheduling, steering and
  planning gateway checks passed all 13 cases and cover the last
  cancellation/verification refinements. A separate fault-injection test verifies
  that post-model artifact persistence failure cannot report successful Work.
- One live native-schema OpenAI request passed with `gpt-5.6`: 127 input tokens
  and 16 output tokens. No tools or user-profile data were supplied. Other live
  provider accounts and local CLI model services were not exercised in this
  tranche; their controlled protocol/subprocess tests passed.
- Formatting and `git diff --check` passed. No dependencies were added.

The first complete run exposed scheduling timeouts: the app update interface
had been deferred with less common tools. Keeping that interface immediately
available restored the existing exact-action scheduling flow; the targeted
scheduling suite and all 206 gateway tests subsequently passed. An older test
fixture also reused a tool-call ID; its IDs are now distinct while the runtime
continues rejecting ambiguous duplicate IDs.

The live smoke test is explicitly opt-in and bounded to one tool-free cloud
request; it never uses the user's application profile or sends an action.

```sh
make check
go test -race ./internal/agent ./internal/model ./internal/orchestrator
HOT_CROSS_BUNS_LIVE_HARNESS=1 go test ./internal/model -run '^TestLiveHarnessStructuredContract$' -v -count=1
```

On this macOS host, canonicalize `TMPDIR` with `realpath` before full checks.
Otherwise sandboxed executable fixtures can encounter `/var` versus
`/private/var` identity mismatches. This does not require relaxing their sandbox.
