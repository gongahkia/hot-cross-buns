# Personal-assistant core improvements — 25 November 2026

Scope: the requested multi-agent coordination, memory, laptop access and reusable
routine/recovery recommendations. Existing stores, permissions, plans, execution
records and UI renderers are reused. No accounts, actual schedules, personal
folder grants, worker credentials or macOS permissions were changed.

## Implemented behavior

- Dependent workers receive bounded, attributed predecessor summaries and
  artifact hashes as untrusted reference data. Encoded dependency context is
  bounded, omitted text is marked and the delivered input hash is retained.
  Failed prerequisites identify the blocking task and do not run dependents.
  Manager completion is blocked while workers remain active. Unavailable roles
  still fail rather than silently selecting another worker. Host prompts require
  reconciliation and disclosure of unresolved conflicting claims.
- `memory_status` exposes scoped freshness/review metadata without stale fact
  text. Current reads include confirmation and review timestamps. A simulated
  multi-month lifecycle covers correction, reopened stores, stale city facts,
  stable preferences and forgetting. Existing sensitive-memory, concept conflict,
  provenance and withdrawal controls remain in use.
- Settings offers a separate, exact-job read-only folder grant. Job definition,
  canonical folder identity, pause/expiry, revocation and protected paths remain
  checked. Foreground/full grants and scheduled grants cannot substitute for
  each other. Normal scheduled work without a grant keeps its earlier surface.
- Parameterized routines are reviewed skill proposals, with reviewed foreground
  activation, exact parameters/revisions, effect enforcement and narrowing
  budgets. Skill readers/writers use the existing knowledge-store lock. Effective
  limits survive sealed execution accounting and later reviewed recovery.
  Timeouts and CLI failures gain structured, conservative recovery guidance.

## Verification

Targeted Go checks passed for coordination, memory, scheduled scopes, routine
storage/proposals, activation, normal Work interaction, routine scope rejection
and remaining-budget recovery. Initial development runs exposed an import-cycle
design error, a scheduler compatibility regression, and invalid test-fixture
setup. Those were corrected without weakening permission or execution checks.

Final-source `make check` passed all Go tests, vet, 129 browser tests,
145 host tests and the OAuth build test. Race checks passed for orchestration,
knowledge, file access and agent accounting. The escaped multi-worker dependency
context regression also passed under the race detector.

An isolated synthetic browser profile verified the command-palette and Settings
routine-library entry points, the saved procedure inspector, source prerequisites,
parameters and limits. Desktop (1280 × 720) and narrow (390 × 844) layouts were
inspected; the narrow dialog remained within the viewport without horizontal
overflow. No user profile, actual schedule or live model was used for this check.
Settings → Permissions also exposed the separate scheduled-read form with the
synthetic job selector and folder field; no folder grant was saved in that flow.

Reproduction:

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
TMPDIR="$task_tmpdir" go test -race ./internal/orchestrator ./internal/knowledge ./internal/fileaccess ./internal/agent
HCB_DESKTOP_NATIVE_SMOKE=1 go test -v ./internal/desktop -run '^TestNativeAccessibilityAcceptance$'
```

## Explicit limits

- **No access:** native macOS acceptance was attempted and skipped because this
  runtime lacks Accessibility permission. Physical application control is not
  verified by the fake-driver tests or this skipped acceptance test.
- Workflow and memory additions use deterministic/scripted test models and
  simulated time. No fresh live-model quality benchmark, paid model evaluation,
  local inference qualification or live Gemini test was performed.
- Generic procedures still need human judgment about successful outcomes,
  contradictory evidence and safe continuation. No automatic replay of uncertain
  external actions or unattended parameterized-routine activation is introduced.
- The new Settings and review paths reuse existing UI components. Browser checks
  cover the routine library and inspector; reviewed routine activation and
  scheduled-folder enforcement are covered by automated tests, not a live-model
  browser session.
