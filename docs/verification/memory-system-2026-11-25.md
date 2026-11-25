# Memory-system implementation verification — 25 November 2026

Scope: significance evaluation, temporal context, budgeted recall, reviewed
consolidation, unified management and derived-knowledge invalidation. See the
[user/developer guide](../MEMORY_SYSTEM.md). Existing stores, review boundaries,
privacy settings and permission controls are reused.

## Required checks

- Final-source `make check` passed all Go tests, vet, 135 browser tests, 145 host
  tests and the OAuth build test.
- Race checks passed for `internal/memory`, `internal/knowledge`,
  `internal/personalization` and `internal/continuity`. The final proposal-label
  and approval-formatting fixes also passed focused regression tests and the full
  project check.
- `node --check scripts/memory-eval.mjs` and the evaluation CLI help path passed.
- The frontend design detector reported no findings in the changed browser
  memory and answer-context modules.

Reproduction on macOS:

```sh
canonical_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$canonical_tmpdir" fnm exec --using 26.7.0 make check
TMPDIR="$canonical_tmpdir" go test -race ./internal/memory ./internal/knowledge ./internal/personalization ./internal/continuity
```

Earlier noncanonical temporary-directory runs hit a CLI sandbox fixture's exit
126. The canonical-path run passed; no sandbox or authorization checks were
relaxed.

## Live provider acceptance

All live calls used the configured OpenAI API key and `gpt-5-mini`, synthetic
statements and disposable state. No personal chat history, folder contents,
connected account, Codex login, Gemini call or user permission was used for the
evaluation. Reports stayed in the ignored verification directory; the
[public summary](memory-system-2026-11-25.json) contains only evaluation outcomes,
usage and bounded diagnostics.

The final production journey passed all **10 steps**:

1. Capture an explicitly stated preference.
2. Recall it in a fresh task.
3. Correct the preference using inspected revision guards.
4. Recall the corrected value rather than the old one.
5. Forget the preference.
6. Return unknown when asked for the withdrawn preference.
7. Create an inactive significance proposal with planned state.
8. Accept its exact source/applicability through the management catalog.
9. Review and save a source-dependent consolidated note.
10. Make that note unavailable after forgetting its source.

That run reported **24 model requests, 268,891 input tokens and 7,790 output
tokens**, taking about 102 seconds. These are provider usage reports, not a price
estimate. Tool descriptions dominate input for this small production journey;
the 4096-token knowledge-selection ceiling is not a total-request ceiling.
Across all six development runs, the aggregate reported usage was 137 model
requests, 963,457 input tokens and 48,747 output tokens. This includes the failed
setup/integration attempts, rather than counting only the successful final run.

The focused development set initially passed 10/12 cases. After the fixes it
passed **11/12**. The remaining correction case exhausted its deliberately
strict four-step completion limit: the model first supplied text instead of a
timestamp, received a validation error, read the current record and retried with
the correct timestamp. It had no step left for normal completion. This remains
a failed focused test, not a claimed pass. The production journey completed the
same correction behavior within its eight-step allowance.

Live testing also exposed two setup/integration failures that were preserved:

- A first production journey exhausted its initial 65,000-token test ceiling.
  The isolated evaluation ceiling was raised to 350,000 without changing behavior
  assertions or the user's application limits.
- A later rerun produced a mixed-case proposed category accepted by the advertised
  schema but rejected by the backend. The schema now advertises the actual
  lowercase pattern, and harmless case/whitespace normalization occurs before
  the complete semantic/withdrawal comparison. Regression tests cover inactive
  candidate creation. The journey additionally checks persisted candidates and
  source dependencies, so a prose proposal cannot count as a successful save.

## Browser acceptance

An isolated synthetic profile verified the running Go backend and browser memory
catalog, candidate review/acceptance, pinning and one-task exclusion. The review
layout was inspected at desktop and 390 × 844 widths. New frontend assertions
cover snooze requests and selected/omitted context explanations; Go tests cover
the resulting policy and exact-conversation ownership behavior. The only
browser-console error was the fixture's missing favicon.

No fake audio, physical device or paid model was needed for this UI walkthrough.
The synthetic browser and fixture process were closed after inspection.

## Interpretation and remaining limits

This is a small development acceptance set. It is not a blind held-out study,
multi-year field trial or comparison across local/cloud models. The reported
quality counters describe their specified probes; they do not establish perfect
memory precision/recall in normal use.

Significance is still model-proposed and reviewable. Ranking uses deterministic
priorities over existing lexical/optional semantic retrieval, rather than a
trained utility model. Source dependencies validate lineage and freshness, not
the independent truth of every generated claim. New foreground consolidation
does not enable an unattended dreaming process. Existing unlinked notes cannot
be safely assigned invented lineage, and retained historical inputs already sent
to a model cannot be retracted by forgetting a current record.
