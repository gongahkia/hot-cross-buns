# Agent Workflow

## Read first

1. `docs/product/prd.md`
2. `docs/architecture/tech-stack.md`
3. `docs/architecture/system-architecture.md`
4. the subsystem spec and tests being changed

## Implementation path

1. Confirm the exact user-visible contract and Google API constraint.
2. Make the smallest C++ service/model/QML change that preserves the boundary below.
3. Add focused C++ or QML coverage for new behavior and its failure path.
4. Build the macOS target and run focused tests, then the relevant full suite.
5. Update the active spec, QA, and release documentation in the same change.

```text
QML -> AppController -> C++ services -> SQLite / Google / platform adapter
```

QML never owns credentials, direct SQLite access, raw Google payloads, or worker lifecycle. SQLite work and remote sync stay outside the GUI thread. User actions create local optimistic state and a pending mutation; sync owns eventual Google application and reconciliation.

## Product rules

- Google Calendar and Google Tasks are authoritative for synced data.
- Notes are opt-in UI projections of undated Google Tasks, not a separate remote object.
- Calendar recurrence is a lossless Google round trip plus Google-resolved instances.
- HCB-managed Google Task recurrence uses an explicit portable marker in task notes.
- macOS release validation precedes Linux and Windows work.

## Required evidence

- focused regression test
- macOS Debug build
- relevant CTest/QML test target
- performance gate when search, sync, SQLite, or views change
- redacted live-account smoke only when local tests are complete
