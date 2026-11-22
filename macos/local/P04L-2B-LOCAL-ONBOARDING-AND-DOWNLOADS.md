# P04L-2B — Local onboarding and reviewed future selection

**Implementation: CONDITIONAL / incomplete. Native acceptance: PARTIAL. Release readiness: BLOCKED.**

This is a working safe subset, not acceptance of the entire requested tranche. Native installation guidance, richer curated browsing, reviewed installed-model selection, private selection receipts and read-only reconciliation are implemented. Native runtime Start, model Download, live download progress and download cancellation are **not implemented or accepted**. Their controls remain disabled and their Go actions refuse admission.

## Baseline and safety prerequisites

Starting HEAD: `d35e47ad3fea5a4c06abeb9b5a8c79338808c7af`. The worktree already contained the complete uncommitted 2A implementation and evidence. [Baseline identities/status](evidence/p04l-2b/baseline.json) capture that tree before 2B edits. No reset, revert, stash, commit, signing or notarization command was issued. Earlier reports, evidence and development bundles are retained.

Read the L1 architecture, lifecycle and eval reports, 2A foundation report/evidence, current local manager/client/transport, model construction, settings/auth/private-file/locking conventions, native provider bridge/coordinator/setup views and relevant safety tests. The current source still uses the repaired 2A transport and fresh settings publication. [Precondition regression](evidence/p04l-2b/precondition-tests.jsonl) re-exercises independent writers, CLI revocation, default conflicts, installed identity changes, redirects/proxy isolation, bounds/cancellation and the managed inference adapter before new native selection is enabled.

The current native manager remains Go-owned. No Swift credential/configuration store, local process launcher, second Go owner or agent framework was added. Local Models and API-Key Providers remain peer tabs. Defaults change only after explicit reviewed selection/save, never because a tab, catalog row or management window opens.

## Capability and acceptance matrix

| Requested capability | Result in this candidate |
|---|---|
| Discover executable / inspect endpoint/version | Existing finite 2A observation retained. Detected path and checked locations remain explicit; detection is not vendor-signature or listener ownership proof. |
| Native installation guidance | IMPLEMENTED: official page link, manual-install explanation, separate weights/disk/memory requirements and Refresh Status. No installer is downloaded or executed. |
| Safe explicit native runtime Start | **BLOCKED**: no verified binary/listening-process association or cross-process launched-runtime lifetime protocol. |
| Curated browsing | IMPLEMENTED: tag, family derived from catalog tag, published package size, catalog capability summary, conservative RAM/disk checks, downloaded/loaded observations, installed digest and future selection. |
| Reviewed first-time download | **BLOCKED**: model use is not leased through all cooperating request/review/recovery lifetimes. No pull is admitted. |
| Existing-tag re-pull/update | **BLOCKED / P04L-2C**, including tags that may replace weights. |
| Genuine progress / cancel download | **NOT IMPLEMENTED** because no safe download admission exists. No fake progress or active Cancel button is shown. |
| Review / select installed curated model | IMPLEMENTED: exact digest/runtime/configuration review, finite confirmation and fresh locked publication. |
| Durable selection intent / outcome | IMPLEMENTED: bounded private versioned receipt with operation/request/profile/generation identities. This is **not** a download receipt or model-use lease. |
| Selection cancellation before confirmation | IMPLEMENTED: revoke the opaque local review without changing settings. Closing a view discards its UI review; it cannot implicitly confirm. |
| Read-only selection reconciliation | IMPLEMENTED: observe current inventory/settings; record observation, never replay or repair defaults automatically. |
| Download-outcome reconciliation | **NOT IMPLEMENTED/NOT ACCEPTED**; there is no admitted native download to reconcile. |
| API-key provider workflow | RETAINED: all 38 rows, secure input, reviewed save/retain/replace/remove, endpoint/options and Go-confirmed future defaults. |
| Delete/unload/cleanup/runtime stop/uninstall | Unavailable; not part of 2B. |

## Why Start and Download remain disabled

The source audit found the following concrete missing contracts; these are not renamed as successful tests:

1. `localModelManager.Start` historically accepts a discovered executable, starts `serve` with inherited environment and waits for a version response. The responding port is not tied to the launched PID/binary identity. `Close` tracks its own child but has only manager-local ownership. It does not establish a shared lifetime across other owners/processes. No new native Start path is enabled over that implementation.
2. The local inference adapter has no cooperating model/runtime lease spanning a complete admitted request, pending exact review, recovery and owner restart. A per-inference HTTP lock or the new selection-publication lock would not establish those lifetimes. Existing state data guards are not per-model use ownership. No native pull can safely rely on them as tag-replacement exclusion.
3. A pull can outlive client transport. There is no implemented durable download receipt and server-outcome reconciliation protocol here. A client cancellation alone could not truthfully establish rollback or cessation of Ollama work. Download/cancel/retry therefore remain unavailable.

The Go boundary refuses `local_start` and `local_download` before HTTP or execution. The managed native legacy terminal-model panel remains blocked by the 2A guard. No UI route was opened around these denials. A running endpoint remains usable for permitted read-only and selection operations **without adoption or authority to stop it**. The existing user-runtime no-adoption regression remains passing.

The remaining implementation must coordinate cooperating Hot Cross Buns processes, not claim exclusion against arbitrary third-party Ollama clients. The lifetime design still needs exact runtime/tag/digest identities, consumer acquisition before use, retained-review/recovery protection, crash reconciliation and explicit release. Start additionally needs reviewed binary identity, minimal child environment, verified listener ownership, bounded readiness and an agreed durable lifetime across screen close, conversation changes and application Quit. Stop is not being added implicitly.

## Installation and catalog presentation

The native local area explains that opening an installation page does not install or verify Ollama, that weights are separate downloads, and that detection/running/ownership are different states. A fixed [official macOS installation page](https://ollama.com/download/mac) is opened only by the user's Link action, through the same HTTP(S)-only/no-credentials external-URL policy used by the native chat. The current official page also offers installer scripts; Hot Cross Buns does **not** execute them. No administrator request or global environment change is introduced.

Runtime detection retains the checked locations from 2A: PATH, `/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama` and `/Applications/Ollama.app/Contents/Resources/ollama`. A detected executable is not described as a cryptographically verified installation. Reachability/version remain independent loopback observations. Ownership stays unknown where it has not been established.

Catalog metadata is compiled from the existing reviewed catalog. “Family” is derived from its tag, not a new publisher-authentication claim. Published package size and capability summary are not measured model memory, quantization, current context allocation or quality. Eligible entries are stably ordered before blocked ones; no model is automatically chosen. Unavailable entries remain visible.

The 2× package RAM-capacity and 20% disk-headroom heuristics are unchanged. Current available memory/pressure remain unknown where macOS cannot provide them. Selection writes configuration only; it does not load weights or certify future inference admission. 16 GB and 8 GB end-to-end acceptance remain P04L-4 work, NOT TESTED here.

## Reviewed selection and exact identities

`local_review_select` resolves an exact catalog ID, checks current conservative eligibility, reads fresh configuration, validates the loopback endpoint, verifies runtime version and installed inventory, and requires a valid server-reported SHA-256 digest. It rereads relevant configuration after observation. No configuration or receipt is written by review.

The Go review contains a random opaque ID, a backend-process generation, exact model/tag/digest/endpoint and a field-scoped settings revision. The revision covers defaults and the managed local-provider record, not unrelated CLI credentials/theme/roles. Expected settings and expiry remain Go-private. Known credential material in untrusted digest/endpoint metadata is rejected rather than displayed, hashed as a credential identifier or copied into a receipt.

`local_select` requires the exact review ID/generation/model and a fresh request ID. It consumes the review, acquires a nonblocking cross-process **selection-operation** lock, checks prior receipt state, then durably records `prepared` before calling the existing local manager's `Use` implementation with the review expectation. This reuses the canonical Go publication path; it is not a parallel Swift settings writer.

The canonical path checks inventory twice, compares the reviewed digest and endpoint, and uses fresh locked `Store.Update`. A concurrent relevant default/provider change rejects publication; unrelated theme, cloud endpoint and CLI revocation edits survive. There is no settings lock around HTTP waits. A successful configuration publication is reported separately from a later status-read error using `LocalUpdate.Published`; UI status refresh cannot manufacture or erase the known publication outcome.

The native review explicitly states future-only effects. Confirming does not invoke inference, load weights, pull a missing tag, change credentials/specialists, switch an admitted request's model or fall back to cloud. A shared future-model header and API-row badges use Go's current selection projection, avoiding a stale cloud-default badge after local selection.

### Digest preflight and its limits

Native reviewed selections persist optional `model_digests` under the existing managed `CustomProvider` configuration. Current settings validation bounds them and permits them only for `hot-cross-buns-local`. Clone helpers copy the map so future edits do not mutate captured values. The configuration version remains readable by older clients because unknown JSON fields are ignored; current writers preserve the optional bindings through fresh updates.

The selected model backend captures its digest string and checks `/api/tags` before each inference request. Missing, changed or uninspectable weights fail with a repair message before backend inference; no fallback runs. The documented [Ollama tags API](https://docs.ollama.com/api/tags) supplies digest metadata; Hot Cross Buns does not scan or hash downloaded blob files.

**This is not an atomic server-side digest pin.** An external client can change a mutable tag between preflight and inference. Older tag-only configurations remain supported without claiming they have a binding. An older writer can drop an optional binding: the current adapter fails closed when the recent native receipt identifies that missing binding, but a complete cross-version/per-model history migration is not implemented. Mixed older/newer writers and immutable artifact execution are not accepted. No native re-pull/update is enabled.

## Receipts, publication and reconciliation

Private path: `<state>/hot-cross-buns/local-selection/selection.json`, with `.operation.lock` and a fixed private transaction file. Paths contain no caller-supplied model/request filename. The receipt is version 1, at most 16 KiB, validates all identities/timestamps/known phases and rejects unknown schema fields. Unix permissions/private Windows conventions use existing `privatefs` helpers. Writes flush the file, atomically rename and sync the directory. The operation lock serializes cooperating processes using this profile state.

The receipt contains only model/configuration metadata: operation ID, request ID, profile hash, Go generation, endpoint, catalog ID, tag/digest, settings revision, phase and times. No API key, prompt, token, tool argument, raw error body or subprocess environment is persisted. Profile identity is checked before exposing a receipt or using it for reconciliation; a mismatched configuration profile is blocked, not silently adopted.

| Phase | Meaning |
|---|---|
| `prepared` | Selection intent recorded before configuration publication; an interrupted outcome requires inspection. |
| `published` | Go's settings publisher returned success. This is historical publication evidence, not a perpetual current-default or live-inference receipt. |
| `failed` | Selection was not confirmed; no automatic retry. |
| `uncertain` | Publication/receipt finalization could not be fully recorded. The UI exposes uncertainty. |
| `reconciled` | Current inventory/settings observed and the observation retained; historical causal completion is not inferred. |

If configuration succeeds but receipt finalization fails, the response distinguishes the known settings publication (`Confirmed`/`Changed`) from the uncertain receipt and returns an explicit error. Other cached owners still refresh future configuration through the existing coordinator path. No false rollback is claimed. A prepared/uncertain receipt blocks a fresh local selection until explicit reconciliation.

`local_reconcile` matches the exact operation ID/profile and current endpoint, reads installed inventory and configuration, and records whether the target digest is currently installed/selected. It performs no selection, download or rollback. Missing/changed weights remain a repair requirement. A new attempt needs a fresh review; stale generation, stale settings, expired review, duplicate request or consumed review cannot replay selection.

This is not a distributed atomic transaction, a model-use lease or a remote mutation receipt. The latest bounded receipt replaces earlier terminal selection records. It cannot certify a past Ollama mutation, or establish a full historical binding ledger for older clients.

## Native bridge and lifecycle

The existing finite `native_provider` channel adds `local_review_select`, `local_select`, `local_cancel_review` and `local_reconcile`; optional typed review/receipt/future-selection fields extend its result. Older result readers can ignore those fields. No dialogue/history/archive schema changed. Unsupported Start/Download requests are explicitly denied in Go.

Swift validates request/action identity, reply bounds, model/review binding and generation, and only shows selection success after a Go-confirmed published receipt. Transport acknowledgement is not success. The sender retains existing owner/generation checks; dismissal/reopen invalidates late local UI publication. Provider tabs keep their non-secret forms and selection. API secure text still clears on disappearance.

Confirmation is a finite asynchronous request. After a confirmed selection, a finite read-only status refresh updates readiness observations. There is no persistent poll, animation scheduler, new runtime process or background agent. Closing the management view cannot launch, stop or adopt Ollama. A submitted selection may finish after view dismissal; its receipt is available on reopening and no UI action is replayed. Application Quit uses the existing bounded provider-operation/shutdown path; the separate historical packaged-desktop Quit/stall gate is not claimed closed.

## Verification coverage and gaps

Implemented tests cover normal review/publication/restart/reconcile, cancel before selection, consumed/expired/wrong-generation reviews, changed/missing digests, concurrent default/endpoint edits, settings write failure, receipt write/finalization failure, profile mismatch, dropped recent binding, CLI revocation through a controlled independent writer, private receipt bounds/symlinks, independent-process selection lock and digest failure before inference. Go approval tests preserve exact pending identity during future-preference refresh.

Swift tests cover protocol fields, receipt/unknown-outcome semantics, local/API parity, cancel, unconfirmed acknowledgement, late response/dismissal, duplicate click suppression and actual Go-backed selection/restart. The actual Go fixture records GET-only traffic; no inference/pull/delete endpoint is invoked. Existing P04 credential workflows, 2A transport/settings regressions, 100-spinner/zero-owner-callback, streaming, reactions and exact approval tests remain required in full verification.

Requested positive Start, wrong-binary/listener, launched-runtime handoff, active model-use exclusion, pull admission, true progress, in-flight pull cancellation and server-side download uncertainty tests are **NOT TESTED/NOT IMPLEMENTED**. Refusing an unsafe action is not counted as passing those positive workflows. There is no invented download performance, quality, model load or GPU benchmark.

Final test counts, resources, native component evidence and source/bundle identities are appended after final verification.

## Remaining release and follow-up gates

Finish the blocked 2B prerequisites before representing local onboarding as complete: model/runtime consumer lease integration with admitted/retained work and recovery; verified safe native Start/lifetime ownership; first-pull admission; durable download receipts; bounded progress; cancellation and nonreplaying reconciliation. That is unfinished 2B work, not permission to start 2C.

P04L-2C remains separate: existing-tag replacement/update, unload/removal, shared storage/cleanup previews and runtime update/uninstall guidance. None is implemented here.

Earlier release debt remains open: historical approval input provenance (old negative test INVALID), the approximately 1.4 GB SwiftUI stall, roughly 23–25% pending/review CPU, and unverified native lifecycle acceptance. No historical desktop matrix was repeated. Physical macOS 15, VoiceOver, IME, external displays, 8 GB hardware and actual local-model quality/inference performance remain NOT TESTED. The new subset does not waive those gates.
