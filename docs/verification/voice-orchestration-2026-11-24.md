# Browser voice and orchestration verification — 24 November 2026

Browser dictation and turn-based voice conversation now use the existing speech helper and the normal chat admission path. Model-issued worker starts require an explicit fresh/continued context choice. Plan-step proposals require explicit dependency intent, and repair feedback preserves the requested dependency and scheduling fields. Saved-note search includes bounded current content previews, with a flag requiring a full read for truncated content.

These changes improve specific failure boundaries. A successful test run does not establish that the model will interpret every future request correctly. The host validates structured fields and permissions; it does not infer a dependency or silently repair the user's intent.

## Automated verification

| Check | Result |
| --- | --- |
| `make check` with Node 26.7.0 and canonical macOS `TMPDIR` | Passed: runtime build, all Go packages, vet, 119 browser tests, 142 host tests, one OAuth build test |
| Focused browser voice suite | 16/16 passed |
| Orchestrator/tools tests in an exported committed snapshot at `85f3b28a8` | Passed |
| Runtime build and 16 voice tests in that committed snapshot | Passed |
| Scoped Impeccable source detector | No findings; regex-only `.mjs` coverage, without rendered layout/contrast verification |
| Fresh live personal-assistant lifecycle, OpenAI `gpt-5-mini` | 14/14 passed |
| OpenAI manager → local Codex CLI → separate work turn/native continuation | 7/7 passed |

Reproduce the full local check:

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
```

The working-tree check included earlier requested features that remain uncommitted. The exported tracked snapshot was checked separately to verify the new voice and tool-contract commits without those edits. The snapshot reused installed Node dependencies and built its own runtime binary; no credentials were copied into it.

## Live evidence and earlier failures

The final lifecycle run checked existing-note identity/provenance, exact step scheduling, dependency persistence and agenda overlap, fresh-chat target-date recall, reported completion, and quiet/overdue decisions. It used 23 reported model requests, 220,499 input tokens and 11,890 output tokens against a fresh synthetic profile. No connected account was changed.

The final run included a malformed plan call with body text. The host rejected it, returned targeted correction instructions, and the model repaired the call while preserving the dependency. Both dependency assertions then passed. This exercises recovery, rather than requiring a mistake-free model transcript.

Earlier complete runs are preserved:

- The first passed 13/14; dependency checks passed, but the model substituted a step deadline for the saved project target date after reading metadata only.
- The next passed 12/14; current-note previews corrected date recall, but tool-call repair dropped the requested dependency. More specific field/nesting feedback and a complete example were added afterward.
- One intervening development run was interrupted after a focused test exposed that the underlying note search strips bodies. Its incomplete result is not counted as acceptance evidence.
- The initial full regression exposed scripted calls lacking the new required fields. Those fixtures were updated without weakening their behavioral assertions.
- A direct browser test run using the symlinked `/var` temporary directory failed the existing canonical-workspace path assertion. The final full check passed with canonical `TMPDIR`; the assertion was retained.

The Codex test used the local CLI's ChatGPT login and `gpt-6.1-sol`; the organization API key powered the `gpt-5-mini` manager. All seven checks passed: successful work, two worker turns, separate work turns, the same native conversation, remembered facts, no copying of remembered facts into the follow-up, and an unchanged original source.

The [committed machine-readable summary](voice-orchestration-2026-11-24.json) retains pass/fail maps and reported lifecycle usage. Full synthetic reports remain locally under `.hot-cross-buns/orchestration-repair-20261124/`: `lifecycle.json`, `lifecycle-final.json`, `lifecycle-repair-feedback.json` and `codex-cross-chat.json`. Earlier failures were not overwritten.

## Voice and provider boundaries

See [Browser voice](../BROWSER-VOICE.md) for setup and behavior. Opening the menu does not select a cloud transcription provider or request microphone permission. Local Whisper requires its optional executable and selected model; `whisper-cli` was not installed on this host during verification. No live cloud transcription was performed using the orchestration key.

The conversation mode alternates listening, transcription, submission and local speech playback. It does not provide simultaneous listening/speaking or voice interruption during playback. Ending voice leaves already submitted assistant work running.

Physical microphone permission, recognition quality, actual audible speech, browser-specific decoding, and rendered responsive appearance were not verified interactively. Cloud transcript routes and local playback were exercised through controlled fixtures. Live Gemini remained excluded by the user's instruction; Copilot and Pi were not newly revalidated here.
