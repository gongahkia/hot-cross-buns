# Memory sync verification · 27 November 2026

The search caret disappeared because its animated overlay remained beneath the
popover top layer while the native caret was transparent. Both input and reading
carets now use the nearest dialog or popover root. Unit and real-browser checks
confirmed a visible caret inside the task search field.

Memory sync retains the existing stores. The new transport contains bounded,
versioned Markdown records, parent-revision identities, privacy exclusions and
per-profile import receipts. Syncthing connection credentials remain in the
private auth store. Conflict choices are revision-checked, forgetting wins over
concurrent edits, and imported records invalidate local retrieval indexes.

Verification performed:

- Memory, knowledge, configuration and sync package tests passed, including
  identity-preserving import, notes, corrections, forgetting, historical
  exclusions, offline aliases, stale conflict choices, concurrent changes,
  linked-directory rejection and immutable-packet tampering.
- Race-enabled sync package tests passed.
- App-tool tests passed for scoped connection, private credentials, offline
  completion reporting, pause/resume review and model setup rejection.
- Browser suite: 194 passed before the additional native sync gateway test;
  that additional test passed separately. Application-host suite: 148 passed.
- Browser inspection confirmed the password field, connection controls and
  collapsed placement under Memory & privacy. The existing native field styles
  are reused. The sync view does not add another top-level settings page.
- Real Syncthing v2.1.7, macOS arm64: checksum verified from official release
  metadata. Two temporary daemons exchanged packets between two isolated HCB
  profiles over loopback. Automatic preference import, revision-bound HCB import
  receipts, pending delivery while offline, and import after reconnection passed.
  No cloud model call or user profile was needed. `scripts/memory-sync-e2e.py`
  reproduces this journey with a separately supplied Syncthing binary.

An initial broad Go run failed the existing strict-sandbox OpenCode credential
fixture with exit 126 under macOS's `/var` temporary-path alias. The whole
workrun package passed when TMPDIR used the canonical `/private/var` path.
The final full `go test ./...` run passed with canonical TMPDIR, and targeted
`go vet` passed. This does not weaken the sandbox or change that unrelated fixture.

Limits: the real transport test used two profiles on one Mac, not two physical
computers or cross-OS filesystems. Syncthing must already be installed, running
and paired; HCB does not install a login service or pair devices automatically.
Sync is disabled in the user's profile until connection setup is completed.
The separate researched-project enrichment gap remains unchanged. Historical
sync revisions can retain prior text; forgetting controls recall rather than
promising secure erasure. See `docs/MEMORY_SYNC.md` for format and scope limits.
