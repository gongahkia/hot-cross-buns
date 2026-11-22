# P04L-2A — Unified model management foundation

**Implementation: PASS for this bounded foundation. Native acceptance: PARTIAL (hosted components and real-Go fixtures only). Release readiness: BLOCKED.** Destructive lifecycle operations and initial local enrollment remain unavailable; the unfinished lease/receipt work is not accepted by this result.

## Product decision and scope

Local models and API-key providers are peer, first-class choices. This supersedes the Advanced-only recommendation in P04L-1; the original audit remains historical evidence. The implementation does not change a user's default, require Ollama for cloud inference, require a cloud key for local inference, or introduce fallback.

The recorded pre-edit baseline is in [starting-source.json](evidence/p04l-2a/starting-source.json). Initial inspection began at `46a613a91c34102f4d9e9b2f8415d1ed6f305c79`; the recorded pre-edit HEAD was `abffb85385411245780c1339eb56043d7caa5a09`. HEAD moved during work. No commit, reset, stash or revert command was issued. Existing reactions, motion, presence, credential workflows, reports and development bundles were retained.

The source inspection covered the local manager/client/host/eligibility and settings publication paths, direct/custom provider construction and management, canonical cloud credential callback, native bridge/panel/model paths, provider setup/coordinator lifecycle, existing independent-writer/security tests and the L1, P04, motion and reactions reports. Relevant source identities, toolchain and final bundle records accompany this report. This is not a model-quality or live inference benchmark.

## Safety findings and implemented boundaries

| Finding | Before | Foundation result |
|---|---|---|
| LF-01 | `Use` loaded a settings document, waited for Ollama, then saved that old document. Independent writes, including CLI revocation, could be lost. `Rename`, `Remove` and comparable provider writers also used whole-document publication. | `Use` inspects and rechecks installed identity outside the lock, then uses existing cross-process `Store.Update` to load fresh settings. It compares reviewed defaults and the managed local-provider record before publication. Unrelated fresh settings remain intact. Rename and directly related provider/recall writers use fresh locked updates. |
| LF-02 | DELETE could succeed before settings publication failed; the old code could also choose a replacement default automatically. No durable mutation receipt existed. | The manager refuses removal **before HTTP or settings writes**, including the terminal manager path. No fallback is selected. Crash-safe destructive publication is not implemented; native destructive controls are unavailable. |
| LF-03 | Management used `http.DefaultClient`; separate managed inference validated its initial URL but used an unrestricted transport. | Both management/embeddings and managed Chat Completions use the contained local transport. The managed local catalog-discovery path also uses that client. Redirect/proxy/response/cancellation tests use fake listeners only. |
| LF-04 | Manager-local ownership did not establish cooperating cross-process model/runtime use. | No cross-process consumer lease is claimed. Native delete/update/unload/stop remain unavailable. Managed native sessions cannot instantiate the legacy terminal model panel and thereby bypass the read-only UI. |

### Fresh settings publication

`Store.Update` already holds `.settings.lock` across fresh load/change/atomic save, including independent processes. That mechanism is reused, not replaced. No HTTP request occurs inside its callback.

`Use` captures defaults and the managed local provider before inspection, performs two installed-inventory reads, compares the target name/size/digest information available from those observations, and rejects changed identity. Inside `Update`, changed defaults or managed-provider configuration cause a conflict. CLI agents, cloud endpoints, roles, aliases and unrelated preferences come from the fresh document. A failure does not report selection success.

`Rename` changes only the requested alias in a fresh transaction. It does not republish a previously loaded alias map or full document. Direct custom-provider CLI updates compare the reviewed provider/defaults/roles/aliases under the same lock, including after discovery. TUI custom-provider save/remove/apply and recall configuration now edit fresh settings. Native API setup retains P04's stricter reviewed full-settings comparison and canonical credential replacement/rollback comparisons.

This is a scoped writer repair, not a claim that every `Store.Save` caller in the product now implements reviewed-field conflict detection. Legacy custom-provider workflows do not gain a new durable review protocol. Native custom-provider definition remains outside this increment.

[Independent-process tests](../../cmd/gator/local_settings_safety_test.go) hold the original HTTP read barrier while a separate executable process changes: default, cloud endpoint, CLI revocation, competing local selection, theme, local endpoint, or settings publication availability. Relevant conflicts reject the old selection; unrelated changes survive. The original L1 independent-writer barrier is retained and now asserts preservation instead of the historical defect. A separate test changes the installed digest between reads. The barrier also demonstrates that selection is not holding the settings lock during the network wait.

The two reads are not a distributed Ollama transaction. An external client can mutate a tag afterward. Missing digest metadata is not manufactured; universal tag/digest exclusion is not established. Native initial selection remains disabled pending the reviewed lifecycle workflow.

### Local transport

`internal/localmodel/transport.go` provides one origin-pinned transport for these local paths. It accepts HTTP literal loopback addresses. `localhost` and `localhost.` are canonicalized to `127.0.0.1` without hostname resolution. Other hostnames, credential-bearing URLs, query/fragment/escaped-path ambiguity, non-HTTP schemes, nonloopback addresses and invalid ports are rejected. The actual dial address is checked as a literal loopback IP again. There is no environment proxy function.

Redirects are refused, including 301/302/307/308; no redirected request is sent. Requests are pinned to the configured origin and reject Authorization, Proxy-Authorization and Cookie headers. Managed local inference rejects a credential environment configuration. Direct cloud/custom remote adapters retain their explicit network policies.

Bounds: two connections/idle connections per client, 64 KiB response headers, 3-second dial timeout, 5-second response-header timeout, 10-second idle connection expiry and 10-minute absolute client timeout for inference/pull. Version, installed and loaded queries have 5-second child deadlines; the combined native observation has an 8-second deadline. There is no permanent refresh poll.

Ordinary local response bodies are limited to 2 MiB; pull progress is limited to 64 MiB total, 64 KiB per record, 100,000 records, bounded status/digest fields and bounded digest tracking. Negative/out-of-range counters, regression within a named digest, malformed/truncated records, post-success records and missing final success are rejected. Installed/loaded inventories are bounded to 256 rows. Missing size remains unknown.

Non-redirect HTTP failures preserve their status for existing structured inference diagnostics, with the untrusted error body removed. The initial attempt to turn every non-2xx into a plain transport error broke that diagnostic regression; it was corrected, not waived. The shared Chat Completions reader now checks one byte beyond its existing 2 MiB limit, rejecting oversized otherwise-valid JSON instead of silently accepting a bounded prefix. No inference protocol or API-key precedence changed.

Loopback transport containment is not a whole-product offline policy. Connected tools, role overrides, cloud embeddings, specialists and the local server's own outbound behavior are separate boundaries.

## Destructive operation and lease contract

No new destructive operation is admitted. The tested removal result is **A: deletion definitely did not occur through this request**: zero DELETE requests and unchanged settings. Repeated attempts are refused rather than replayed. There is no new receipt database or misleading receipt for a denied operation.

The remaining lifecycle implementation must distinguish:

| Outcome | Required future evidence and behavior |
|---|---|
| A — not deleted | Admission refusal or definite pre-mutation failure; unchanged selection; no destructive retry. |
| B — deleted/settings correct | Exact operation/runtime/tag/digest identity, reviewed settings state, durable completion and verified settings publication. |
| C — deleted/settings failed | Persist a bounded partial result; retain the user's intended selection transition and observed inventory; explicit repair, no false rollback. |
| D — outcome unknown | Persist uncertainty; read-only reconciliation, no automatic delete/re-pull/fallback/replay. |

B/C/D crash recovery and mutation receipts are **not implemented here**. Historical L1 partial-commit evidence is preserved; it is not relabeled as a successful mutation. Read-only status can show current inventory and future configuration, but cannot prove the causal outcome of a past unreceipted delete.

Future cooperating leases must cover pending inference, active requests, retained exact reviews and recoveries that still depend on the captured model, multiple Go owners and separate Gator processes. Lease identity needs profile/owner/generation/run, runtime origin and ownership generation, exact tag and observed digest. Admission and release must be under a stable cooperating lock, with crash reconciliation that does not trust PID reuse or an arbitrary timeout. Mutable RealityKit/presentation state is unrelated. No second model supervisor is introduced.

An already reachable Ollama remains unadopted; the existing no-adoption/no-stop fixture passes. Terminal `Start`/`Close` still track their own child only; their manager-local ownership does not solve the historical shared-use risk. Native managed runtime start/stop is not exposed. Existing terminal pull/start are not certified as cross-process lease-safe. A Gator lease cannot exclude arbitrary third-party Ollama clients; future destructive operations must disclose or refuse unsupported exclusivity.

## Unified native management

The existing Models and Providers window now has two peer segmented areas: **Local Models** and **API-Key Providers**. Neither is under Advanced. The window initially retains P04's API editor; this is navigation state, not a model-default change. Existing full-window, compact-chat and menu entries open the same window/owner lifecycle.

The local area reports:

- Detected executable path and exact discovery coverage: PATH, `/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama`, `/Applications/Ollama.app/Contents/Resources/ollama`. Detection is not execution or installation certification.
- Version-endpoint reachability, reported version, validated endpoint and unknown ownership. A failed request does not prove an uninstalled or stopped runtime.
- Reviewed catalog entries, exact tags/source links and unchanged conservative 2× download-size RAM eligibility.
- Installed inventory with size/digest when supplied; downloaded state unknown if the inventory fails.
- Loaded-tag state from a separate `/api/ps` GET. Missing loaded inventory is unknown, not “not loaded.” Loaded tags do not establish a captured in-flight request's exact model digest or a use lease.
- Global future provider/model, separately configured local model, total RAM and available-memory/disk only when measured. macOS available-memory/pressure admission remains incomplete.
- Explicit lifecycle blockers and an unavailable initial-selection action. Existing configured future choices remain in the conversation model picker.

The screen distinguishes detected runtime, reachable runtime, downloaded tag, reported loaded tag, configured local model, selected future model and live-tested model. No live test is performed. No weights are loaded or downloaded to open the window. Only supported path metadata and disk-space inspection are used; no arbitrary directory scan is added.

Long inventories use lazy layout. An eager 320-row maximum fixture initially caused expensive pending layout work under rapid hidden-host creation. A matched, settled comparison retained identical fixture sizes and showed substantially lower initial layout cost with lazy content. This is a new view-specific improvement, **not** an explanation or closure of the historical 1.4 GB SelectionOverlay stall.

### API-key parity and credentials

The P04 editor, native secure input, review state, canonical Go save callback `saveTUICloudModelConfiguration`, credential store, replacement/retain/removal checks, endpoint review and future-default confirmation remain in use. All 38 existing native built-in provider rows remain available. Unsupported CLI/OAuth/custom-definition paths retain their limitations; no vendor CLI credentials are imported.

Switching away from the API editor destroys its transient secure entry and clears UI-held key text through the existing lifecycle. Non-secret forms remain in `NativeProviderSetup`. No credentials enter the new local request. Known Gator/ambient provider credentials are redacted from untrusted status fields, and invalid/oversized diagnostics use bounded generic text. No auth-store, credential persistence, archive, approval or task-ownership implementation was changed.

Configured, locally ready and live verified retain P04's meanings. Opening/refreshing/saving does not make a paid provider request. Local runtime failure does not block API setup; an unconfigured API provider does not block local inspection.

## Finite bridge and view lifecycle

The existing private `native_provider` action gains **`local_status`**; the result gains an optional typed **`local`** observation. This reuses the managed provider host rather than creating another Go owner, command engine or process. No new durable conversation schema is needed; older clients never request this new action and can ignore its optional result field.

The request carries a fresh request ID and no mutation fields. The response carries the same request/action identity, a separate random result ID, observation time, bounded catalog/status fields, explicit unknowns and safe errors. Transport acknowledgement is not completion. Status refresh never sets `Confirmed`/`Changed` as though it had saved configuration.

Only one provider/status operation is pending per existing host. Repeated refresh clicks do not start parallel operations. Go rechecks relevant future selection/endpoint state after observation and rejects a conflicting result. Swift matches request/action identity, validates observation bounds, retains the pinned owner/generation checks and suppresses publication after dismissal/reopen. Connection loss requires explicit reopening/refresh; no request is replayed. Dismissal invalidates publication and clears local UI state; an already submitted read may finish within its bounded deadline. It is not a new immediate wire-level cancellation protocol.

Read-only status leaves an opaque credential review intact. It does not refresh captured Work options, mutate approval identity, transfer a token, submit chat, pull a model or create an owner. The Go regression includes a real Workapp pending approval token, stale read completion and duplicate read admission; its canonical pending approval remains unchanged. Historical unattributed input remains a separate INVALID test, not resolved by this prospective regression.

## Measurements and native evidence

Environment/toolchain: [environment.json](evidence/p04l-2a/environment.json). Apple M3, 16 GiB, macOS 26.5.2; debug SwiftPM build, macOS 15 deployment target. These are fixture/component results, not inference TPS, full-app resource acceptance or an 8 GB hardware result.

The read-only Go refresh benchmark used the same fake three-GET server and disposable configuration, 20 iterations × three trials: approximately **2.41–2.54 ms/refresh**, **332–334 KB allocated/refresh**, approximately 3,667–3,672 allocations. It includes host inspection and in-process fake HTTP handling. It does not measure a real Ollama server or native window latency. See [refresh-benchmark.log](evidence/p04l-2a/refresh-benchmark.log).

Matched hidden-host layout comparison, 64 catalog + 256 installed fixture rows, 12 create/close lifetimes with 150 ms settling, then two seconds idle:

| Measure | Eager fixture | Lazy fixture |
|---|---:|---:|
| Median initial layout | 132.51 ms | 6.52 ms |
| Process physical footprint baseline | 7.20 MiB | 7.22 MiB |
| Peak process footprint during fixture/capture | 101.44 MiB | 34.03 MiB |
| Settled process footprint | 44.42 MiB | 21.13 MiB |
| Two-second settled CPU, one-core units | 0.042% | 0.019% |
| Live host probes after each settled close | 0/12 | 0/12 |

These are **physical footprint**, not RSS; raw samples contain both. Peak includes test capture buffers/framework initialization. The first rapid, nonsettling eager stress probe also forced fitting-size calculation; its ~60% pending CPU and rising memory are retained separately and are not used as a matched performance comparison. The settled eager trial released its hosts too; the original stress result is not labeled a proven product leak.

The first full-ScrollView bitmap probes were blank, both cached AppKit capture and ImageRenderer. They are **INVALID visual evidence**, retained as such. Valid native SwiftUI **runtime-details component** light/dark renders are in the final hosted evidence; they are not full-window desktop screenshots. No onscreen window was ordered, no input was injected, and no shared-desktop acceptance was attempted. Layer/compositor/GPU energy, physical focus/scrolling, full-window visual interaction and external display acceptance remain NOT TESTED. Component CPU does not resolve the old pending-review CPU observation.

Final component samples, screenshot paths, test totals and source/bundle identities follow below.

## Next increment gates

**P04L-2B, not executed:** official install guidance; verified discovery and optional owned start; reviewed catalog downloads with disk/network budgets, bounded progress/cancel/reconciliation; explicit verified future selection; API setup parity refinements. Preserve the current 2× guard until real admission evidence supports changes.

**P04L-2C, not executed:** exact loaded identity/use leases; unload; reviewed re-pull/update; durable mutation receipts and partial/unknown outcomes; explicit safe selection transition; removal/storage/cleanup previews; runtime update/uninstall guidance. No recursive shared-directory deletion, arbitrary installer script, automatic reinstall or user-runtime teardown.

The historical native layout stall, roughly 23–25% pending/review CPU, unknown approval-input provenance and unverified ten-cycle desktop matrix remain open release blockers. Physical macOS 15, 8 GB hardware, VoiceOver, IME and external displays are NOT TESTED. Local model quality, model-memory admission and actual provider availability are NOT TESTED.

## Final candidate evidence

The [pipe-level fixture](lab/read_only_status_fixture.py) uses the final bundled Go executable, one known child PID, private pipe input, an inert local HTTP server and disposable configuration. It sends only `local_status` and a final Go exit frame; no UI or approval input is injected. Twenty refreshes produced 60 GETs, 20 distinct result identities, unchanged configuration hash and normal process exit. The separate Swift real-Go test exercised the same packaged runtime through the actual coordinator/provider protocol, preserving the unsent draft, one owner, generation and both provider areas.

[Public result](evidence/p04l-2a/pipe-fixture/final-public-result.json), [resource and request records](evidence/p04l-2a/pipe-fixture/bridge-resource-results.json), [fixture output](evidence/p04l-2a/pipe-fixture.log). These establish new read-only bridge behavior; they do not retroactively validate historical approval input.

| Packaged Go fixture phase | CPU (% one core) | Total RSS | Total physical footprint |
|---|---:|---:|---:|
| Initial idle (1.01 s) | 0.363% | 35.72 MiB | 16.20 MiB |
| 20 back-to-back refreshes (0.081 s) | 65.05% | 40.34 MiB | 19.63 MiB |
| Settled (2.00 s) | 0.0012% | 40.34 MiB | 19.63 MiB |

Median refresh round trip: 3.76 ms; maximum 6.49 ms. Incremental settled RSS is 4.62 MiB; incremental settled physical footprint is 3.42 MiB. These are separate measures. The active CPU interval is a deliberately rapid 20-request burst, not sustained native idle/review load. CPU covers the Go process, excluding the short sysctl children and the Python server/controller.

The external sampler uses SDK-verified `rusage_info_v0`, system Mach timebase conversion and a self-CPU-clock calibration. An initial unit check failed before launching Gator; that invalid run is preserved and excluded. Final conversion ratio was 0.9999 versus the CPU clock. No guessed GPU/energy figure is supplied.

Final hosted fixture: median initial layout 6.28 ms; settled two-second CPU 0.032% of one core; process physical footprint baseline 7.31, peak 86.59, settled 25.63 MiB. This final artifact run includes ImageRenderer, duplicate component rendering and bitmap/PNG buffers, so its peak is **not** attributed to production UI memory. There is no ImageRenderer in production. All 12 host weak probes were nil after close; no window was ordered onscreen. Raw RSS/footprint samples are retained in [final-hosted](evidence/p04l-2a/final-hosted/hosted-resources.json).

Valid partial-component illustrations: [light runtime details](evidence/p04l-2a/final-hosted/runtime-details-light-hosted.png), [dark/minimum-width runtime details](evidence/p04l-2a/final-hosted/runtime-details-dark-minimum-hosted.png). They use native SwiftUI text in light/dark environments with controlled raster backings. The first dark backing resolved as Aqua and produced white-on-white output; it is preserved in `final-hosted-before-dark-backing` and is INVALID appearance evidence. The final capture helper uses an explicit test-only dark backing and asserts non-background content. Focused strict verification passed after that artifact-only correction; production styling was unchanged. Full-window/compact interaction, physical VoiceOver/IME, actual dark-mode window behavior and a packaged-native recording are NOT TESTED.

## Verification commands and results

```sh
swift build --package-path macos --scratch-path /tmp/gator-native-build

PATH="/Users/gongahkia/.local/share/fnm/node-versions/v26.7.0/installation/bin:$PATH" \
GATOR_TEST_BINARY=/tmp/Gator-Native-P04L2A-Models.app/Contents/Resources/gator-runtime \
swift test --package-path macos --scratch-path /tmp/gator-native-build --no-parallel

# same PATH and GATOR_TEST_BINARY
swift test --package-path macos --scratch-path /tmp/gator-native-build --no-parallel \
  -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors

go test -json -count=1 ./internal/localmodel ./internal/modelcatalog ./internal/config \
  ./internal/auth ./internal/workapp ./internal/model ./internal/model/chatcompletions \
  ./internal/cliagent ./internal/retrieval ./internal/workrun ./internal/worksession ./cmd/gator

go test -race -json -count=1 ./internal/localmodel ./internal/config ./internal/modelcatalog \
  ./internal/workapp ./internal/model ./internal/model/chatcompletions ./internal/auth ./cmd/gator

PATH="/Users/gongahkia/.local/share/fnm/node-versions/v26.7.0/installation/bin:$PATH" \
npm test --prefix app-host

python3 macos/local/lab/read_only_status_fixture.py \
  /tmp/Gator-Native-P04L2A-Models.app/Contents/Resources/gator-runtime \
  macos/local/evidence/p04l-2a/pipe-fixture

# requires a fresh destination; do not overwrite an existing candidate
GATOR_NATIVE_APP_PATH=/tmp/Gator-Native-P04L2A-Models.app bash macos/scripts/build-dev-app.sh
```

| Verification | Final result |
|---|---|
| Swift build/package | PASS |
| Complete normal Swift suite | **311 PASS**, 150.581 s |
| Complete strict Swift 6 suite | **311 PASS**, 134.870 s; zero warnings/errors |
| Final hosted capture/lifetime strict test | **1 PASS**, readable-raster and 12 zero-live-host checks |
| Go full regression | **12 packages PASS**, 1,596 passing test/subtest events, 16 skips |
| Go race regression | **8 packages PASS**, 1,206 passing test/subtest events, 14 skips; no race failures |
| Node 26 host suite | **141 PASS**, one Windows-only/platform skip, zero failures |
| Real-Go native local status | PASS, packaged runtime; three GETs; no default/draft/owner changes |
| Packaged pipe fixture | PASS, 20 refreshes/60 GETs, unchanged settings, normal Go exit |
| Scoped gofmt/whitespace | PASS |
| Actual packaged desktop interaction | NOT TESTED |

Go live/paid/native operator tests remain skipped, along with process-helper entrypoints in the parent run and platform-specific cases. Helper entrypoints are exercised by the independent-process parents; they are not silently counted as ordinary standalone passes. Live-test opt-in environment variables were removed for the Go regression runs. No real download, model deletion/unload, runtime install or paid inference occurred. Full Swift P04 provider save/retain/replace/remove, credential permissions/redaction, P04U streaming, P04E-2 reactions, Unicode identity, exact approval/recovery and shutdown suites remain passing. The original 100 spinner-only snapshots → zero owner callbacks regression and meaningful/future-field snapshot publication tests are preserved without editing the dedup implementation.

Logs: [normal Swift](evidence/p04l-2a/swift-full.log), [strict Swift](evidence/p04l-2a/swift-strict-full.log), [Go full](evidence/p04l-2a/go-full.jsonl), [Go race](evidence/p04l-2a/go-race.jsonl), [host](evidence/p04l-2a/host-tests.log), [test summary/skips](evidence/p04l-2a/test-summary.json), [package](evidence/p04l-2a/package-final.log). Initial development failures and pre-final runs are retained separately rather than edited into passing evidence.

## Changed-file inventory and identities

Production files changed or added in this increment:

- `cmd/gator/command_local.go`
- `cmd/gator/command_provider_config.go`
- `cmd/gator/local_manager.go`
- `cmd/gator/model_management.go`
- `cmd/gator/native_local_status.go`
- `cmd/gator/native_provider_management.go`
- `cmd/gator/provider.go`
- `cmd/gator/reviewed_model_settings.go`
- `cmd/gator/work_recall.go`
- `internal/localmodel/ollama.go`
- `internal/localmodel/transport.go`
- `internal/model/chatcompletions/chatcompletions.go`
- `internal/modelcatalog/native_local.go`
- `internal/modelcatalog/native_provider.go`
- `internal/workapp/bridge_native_provider.go`
- `internal/workapp/models.go`
- `macos/Sources/GatorCore/NativeLocalStatus.swift`
- `macos/Sources/GatorCore/NativeProviderProtocol.swift`
- `macos/Sources/GatorCore/NativeProviderSetup.swift`
- `macos/Sources/GatorMac/LocalModelInspectionView.swift`
- `macos/Sources/GatorMac/ProviderSetupView.swift`

Verification sources and isolated harness:

- `cmd/gator/command_local_test.go`
- `cmd/gator/local_first_audit_test.go`
- `cmd/gator/local_settings_safety_test.go`
- `cmd/gator/native_local_status_test.go`
- `cmd/gator/local_inference_transport_test.go`
- `cmd/gator/work_models_test.go`
- `internal/localmodel/ollama_test.go`
- `internal/localmodel/local_first_audit_test.go`
- `internal/localmodel/transport_safety_test.go`
- `internal/workapp/bridge_native_local_test.go`
- `macos/Tests/GatorCoreTests/NativeLocalStatusTests.swift`
- `macos/Tests/GatorCoreTests/NativeLocalIntegrationTests.swift`
- `macos/Tests/GatorCoreTests/Fixtures/local-inspection-provider.mjs`
- `macos/Tests/GatorMacTests/LocalModelInspectionTests.swift`
- `macos/local/lab/read_only_status_fixture.py`

This report and `macos/local/evidence/p04l-2a/` are the remaining deliverables. No README, dependency manifest, Go auth-store, Go execution/approval policy, coordinator ownership, native archive, streaming/presence/reaction implementation or app icon source was edited for this increment.

Final recorded HEAD: `d35e47ad3fea5a4c06abeb9b5a8c79338808c7af`. Working-source hashes are authoritative for the dirty/concurrently changing tree: [production](evidence/p04l-2a/production-source-hashes.json), [verification](evidence/p04l-2a/verification-source-hashes.json), [final status/inventory](evidence/p04l-2a/final-source.json).

Candidate: `/tmp/Gator-Native-P04L2A-Models.app`.

- Native executable SHA-256: `7dc537b594f38ac61548ef77e28a42eb286065c2d45104b0ca984cd89944a2cc`.
- Go runtime SHA-256: `b03ffca962161912b84deb5684701322beae2fce1b27f6ba58ed34199253a01e`.
- [All bundled files/sizes/hashes](evidence/p04l-2a/bundle-files.json).
- [Native minimum OS](evidence/p04l-2a/native-deployment.txt): **15.0**; SDK 26.5, not macOS 15 runtime acceptance.
- [Native linked frameworks](evidence/p04l-2a/native-linked-frameworks.txt); no new live-3D runtime or resource dependency.

The app was built in a fresh destination. Earlier in-progress candidates were preserved as `Models-Initial`, `Models-PreBounds` and `Models-PreLegacyGuard` variants while the final source was corrected. Prior accepted/conditional development bundles were not replaced. The bundle contains its Go runtime, existing presence GIFs and branding resources; local catalog/status requires no checkout file or downloaded model asset. The real-Go tests invoke that installed runtime from disposable workspaces. Native executable startup outside the checkout was not operator-tested.

**Final decision: implementation PASS for P04L-2A's safe read-only foundation; native acceptance PARTIAL; release readiness BLOCKED.** No P04L-2B/2C workflow is authorized by this verdict. Leases, destructive receipts, initial local enrollment/admission and the historical native release findings remain explicit follow-up gates.
