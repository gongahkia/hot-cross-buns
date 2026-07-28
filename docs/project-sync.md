# Project synchronisation

Wukong calculates all desired files and conflicts before changing a project.
It stages copies below `.wukong/.transaction`, records every rename intent and
the SHA-256 of each staged output in a flushed journal, moves existing proven
files to a rollback area, publishes staged files, then publishes `state.toml`
last. A completed marker retains the new state; the next sync recovers an
interrupted transaction to its prior state only after verifying each written
output still matches its recorded hash.

If an interrupted output changed before recovery, Wukong leaves that file and
the transaction intact rather than deleting a possible user edit. Inspect and
resolve `.wukong/.transaction` manually, then retry. Incomplete legacy `v1`
transactions with published outputs also fail closed because they lack output
hashes. See [ADR 0033](adr/0033-hashed-transaction-recovery.md).

Each project mutation holds `.wukong/mutation.lock`. Another active mutation
fails fast with a retry diagnostic. The lock file persists safely after release
or interruption because its advisory state belongs to the operating system; it
is not evidence that a mutation remains active. See
[ADR 0030](adr/0030-advisory-operation-locks.md).

Unowned project files and modified prior package files are never overwritten.
Removal requires both prior ownership metadata and a matching recorded hash.
