# Live filesystem verification — 24 November 2026

Foreground tasks now have live filesystem tools with inline task-only, persistent folder and persistent full-filesystem decisions. Settings → Permissions manages those grants and related capability controls. Configured CLI workers receive the live folders acquired for their assignment, separately from the private checkout.

## Observed checks

| Check | Result |
| --- | --- |
| Full `make check`, Node 26.7.0, canonical macOS `TMPDIR` | Passed: runtime build, Go tests/vet, 126 web tests, 143 host tests, one OAuth build test |
| Permission/CRUD contracts | Passed: one-task grants do not persist; saved read grants do not widen to writes; full mode and revocation; denied/cancelled/stale reviews; folder replacement; fresh-hash writes/deletes; no blind replacement; empty-only directory deletion; protected records and symlinks |
| Plan-first discovery and dispatch | Passed: live tool remains available to reviewed read/filesystem plans; read plans reject writes, deletion and acquisition of write authority before dispatch |
| Requested delegation scope | Passed: a stored CRUD permission does not give a worker writes when the task acquired only read access |
| Web → host → Go review | Passed for once, always and full: stale/invalid decisions rejected, original pending read resumed, Settings reflects the chosen policy and can revoke it |
| Settings | Passed: canonical folder preview before saving, full-access review, stale-policy rejection, full mode off, revoke all; existing panel components and wrapped action layout reused |
| Worker OS sandbox, macOS | Passed: approved live read/write succeeds; sibling files and protected HCB control records remain inaccessible |
| Worker revocation | Passed against an actual sandboxed fixture subprocess: live write begins in its allowed folder, policy revocation cancels the worker, later fixture write does not occur |
| Focused race suites | Passed for fileaccess, sandbox, workrun, workapp and command controls; later symlink/scope additions also passed focused race checks |
| Symlinked config directory | Passed: an alias resolves to the exact canonical config directory before review and subsequent reads reuse that grant |
| Full-mode protected paths | Passed: actual macOS sandbox allows a full-root test write while denying control records; symlinked configuration directories remain protected by their canonical paths |
| Windows fileaccess cross-compile | Passed; Windows runtime acceptance was not performed |
| Actual local Codex live CRUD | **5/5 passed** in 20.06 s: successful worker, actual create/update/delete, unchanged private checkout; existing local Codex login |
| Actual OpenAI manager → local Codex handoff | **6/6 passed** in 32.89 s: manager succeeded, one inline read grant, Codex delegated/completed, live marker returned, manager did not read the file itself |

The handoff used `gpt-5-mini` for the synthetic manager and the locally configured Codex CLI model. The selected model in the normal app was not changed. The manager's organization API key was not used for the Codex worker. Synthetic folders and isolated state were used; the user's actual Neovim configuration was not inspected or modified. No persistent permission was enabled for the normal app profile during verification.

The user committed the existing workspace as `14eb0df0b` while implementation was in progress; that commit was preserved. Subsequent atomic commits contain the permission tests/hardening, worker integration, Settings/reviews, symlink/identity checks and live handoff qualification.

## Failures found and corrected

The initial broad focused test used the ambient `/var` temporary-path spelling and hit the existing sandboxed CLI credential fixture's exit 126. Tests passed using canonical macOS `TMPDIR`; no sandbox boundary was relaxed. Adding the Settings destination initially collided with the older `/permissions` inspection command; the final route preserves the old status fallback when product controls are unavailable.

The first web integration run rejected the new choice field in the host's existing frame allowlist. The field is now explicitly admitted only on approval frames, validated against once/always/full, and still bound by the exact Go review token and review kind. All three web flows then passed. Compile checks caught a nonexistent event constant in the handoff test and a shadowed local name in the final protected-path guard. Both were corrected before the final regression; the event correction preceded the live inference run. A targeted plan-mode test also reproduced the new operation-based tool being hidden by the static plan filter. The filter now advertises it for read/filesystem plans and checks each exact operation at dispatch; the regression and race test passed. No failed live inference result was hidden or retried to inflate the reported pass count.

## Reproduce

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
TMPDIR="$task_tmpdir" go test -race ./internal/fileaccess ./internal/sandbox ./internal/workrun ./internal/workapp ./cmd/hot-cross-buns -run 'Test(Live|StoredCRUD|PersistentGrants|PermissionDecision|Symlinks|ReadGrant|ReviewedLive|ReviewedFiles|InlineFilesystem|BackgroundWork|DelegatedCLIUses|PermissionSettings|FilesystemApproval)'
```

Opt-in paid/live tests require a new report path:

- `HCB_LIVE_CODEX_FILES_REPORT=/absolute/new-report.json go test -v ./internal/cliagent -run '^TestLiveCodexFilesystemGrant$'` uses the existing configured local Codex login.
- `HCB_LIVE_FILES_HANDOFF_REPORT=/absolute/new-report.json go test -v ./cmd/hot-cross-buns -run '^TestLiveFilesystemCodexHandoff$'` also requires the manager credential in its environment. Load it through the existing local app environment; do not put a key value in argv or the report.

Local logs/reports: `/tmp/hcb-files-complete-check.log`, `/tmp/hcb-files-race.log`, `/tmp/hcb-files-final-scope.log`, `/tmp/hcb-files-symlink-worker.log`, `/tmp/hcb-files-web.log`, `/tmp/hcb-live-codex-files-20261124.json`, `/tmp/hcb-files-handoff-20261124.json`.

## Limits

These results establish the exercised permission/handoff paths, not universal model reliability. Live reads/writes in the direct tool are bounded UTF-8 operations; recursive deletion and unbounded binary editing are excluded. CLI live scopes are separate from direct-tool operation bounds. Internal researchers remain read-only; internal Code keeps its staged patch contract. Pi's existing adapter/configuration issue remains separate and was not live-revalidated. No live local-inference model, Linux namespace runtime, Windows filesystem runtime or rendered visual browser acceptance was exercised.

Revocation monitoring is periodic; external-process edits, dispatch races, termination or already-completed effects cannot be undone by changing permissions. Hash checks do not make replacement/deletion transactional against unrelated processes. Inspect actual state before retrying an uncertain mutation. See [usage and boundaries](../LIVE-FILESYSTEM.md).
