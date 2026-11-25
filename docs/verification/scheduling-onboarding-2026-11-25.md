# Scheduling and conversational onboarding verification

Verified November 25, 2026 against the local browser entry point and native Go backend. All introduced onboarding data used in tests was synthetic and kept in disposable profiles.

## Automated checks

- `make check` with Node 26.7 and a canonical macOS `TMPDIR`: all Go tests and vet passed; 144 browser tests, 145 app-host tests and the OAuth build test passed.
- Focused introduction tests passed after the final prompt and timeout adjustment: native admission, transcript ownership, exact quote validation, confirmed batch capture, rejected stale/replayed reviews, restart, skipping and normal task continuation. The corresponding browser/rendering run passed all 65 tests.
- `go test -race ./cmd/hot-cross-buns ./internal/workapp -run TestIntroduction -count=1`: passed. Scheduler/memory race checks also passed.
- `git diff --check` passed. The Impeccable detector reported no findings in the changed browser modules.

The normal Go suite intentionally does not invoke opt-in external-provider acceptance suites. Bounded live onboarding acceptance was run separately below.

## Live provider acceptance

The actual OpenAI `gpt-5-mini` orchestrator was exercised through the production HTTP gateway, native conversation admission, model adapter, memory store and browser catalog. The test used the existing environment credential with an isolated temporary configuration, source folder and state directory. It did not use the person's saved profile, local CLI agents or external action tools.

An all-answers-in-one-message run passed: the host proposed three verbatim facts, the memory catalog remained empty before confirmation, and “yes please” saved one name, one preference and one project context record.

The initial separate-reply run exposed a premature summary and a provider request exceeding the original 20-second deadline. No batch was saved in that failed run. The follow-up instructions now explicitly ask each missing basic before proposing, unless declined; the onboarding request deadline is bounded at 40 seconds. The repeated live run passed:

1. “My name is Alice.” → the orchestrator asked about reply style; memory stayed empty.
2. “I prefer casual and concise replies.” → it asked about projects/help; memory stayed empty.
3. “I'm working on a garden project.” → the host showed all three exact quotes for one review; memory stayed empty.
4. “yes please” → the host saved all three records and marked onboarding completed.

These are development acceptance runs, not a statistical reliability or local-model parity evaluation. Provider availability and latency can still cause a bounded request to fail; a failed question does not authorize a memory save. First-load welcome text and the exact final confirmation are host-authored; questions and follow-ups use the selected orchestrator.

## Browser inspection

Playwright was used against disposable local profiles at desktop and 390-pixel mobile widths. The rendered result was inspected visually.

- First load showed HCB's welcome as an assistant message in the ordinary chat, with the regular composer and no onboarding form.
- Replies, the combined memory summary and “Saved to memory” appeared in that same transcript. Reload retained one welcome and did not restart completed onboarding.
- One-time tasks showed a readable date, time and timezone; recurring tasks showed readable timing. The editor offered date/time controls instead of cron syntax.
- Review and Scheduled tasks controls contained only SVG icons. Saved schedules kept their icon while their fixture supervisor was offline. Empty activity controls disappeared.
- With no pending proposals or saved tasks, the header was empty and Cmd+K still listed Delegated work, Agents, Review queue and Scheduled tasks.

The fixture browser reported an existing missing-favicon 404; no application JavaScript errors were observed. Own test browsers and fixture servers were closed after inspection.

## Local server and limits

The main server was confirmed idle before restarting. The updated app is available at `http://127.0.0.1:4317/`, with its own native scheduler process running. No pending user proposals were accepted as part of this verification.

The scheduler resumes with the backend; it does not wake a sleeping laptop. Saved pause/end boundaries, permissions and budgets continue to apply. Existing explicitly configured missed-run policies remain unchanged. See [Scheduling, time and first-load introduction](../SCHEDULING_AND_INTRODUCTION.md) for behavior and recovery boundaries.
