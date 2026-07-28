# ADR 0015: cache integrity verification

## Status

Accepted

## Context

Prepared cache objects are reused across projects and must not be trusted only
because a directory exists at a content-addressed path. Cache corruption must
be diagnosed without deleting entries whose ownership Wukong cannot prove.

## Decision

Treat the lowercase SHA-256 directory name as the expected canonical
package-tree hash. Before a prepared cache object is read, re-prepare it into
a temporary verification tree and compare its hash with that name. A matching
object is usable. A recognized mismatching object is cache-owned and removed;
the caller receives an integrity diagnostic with recovery guidance.

`wukong cache verify` scans prepared package objects in deterministic filename
order. It reports verified and removed-corrupt counts, returns integrity exit
code 4 when it repaired corruption, and leaves unrecognized cache entries
unchanged with an integrity diagnostic. The current command verifies only
prepared package objects because download and checkout cache objects do not yet
have implemented formats.

## Consequences

Cache reads incur hashing and tree validation. A corruption repair requires a
later source operation to repopulate the object. Unknown entries are retained,
which may require manual cache maintenance but avoids deleting unproven data.

## Alternatives considered

- Trusting a content-addressed pathname: rejected because filesystem damage or
  a malicious local change can make its content diverge.
- Removing every unrecognized entry: rejected because Wukong cannot prove its
  ownership.
- Verifying only via a maintenance command: rejected because normal cache
  reads would remain vulnerable to poisoned objects.

## Migration and compatibility impact

No cache-object format changes. Existing invalid prepared objects are removed
on their next verified read or cache-verification run.
