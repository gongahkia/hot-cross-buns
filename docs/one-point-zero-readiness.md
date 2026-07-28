# 1.0 readiness decision

## Decision

Do not pursue a `1.0` release yet. This is a no-go decision, not a prediction
of product quality. The required external evidence and three-platform CI do
not yet exist.

## Evidence ledger

| Requirement | Current evidence | Decision status |
| --- | --- | --- |
| External recurring users | No verified recurring-user record. | open |
| Stable manifest and lockfile semantics | Versioned formats, ADRs, deterministic serialisation tests, and an explicit 1.0 compatibility policy exist. | insufficient external stability evidence |
| Manageable support burden | No external support history. | open |
| Strong compatibility corpus results | Twenty pinned public fixtures passed source verification; 50/100 targets are open. | insufficient |
| No unresolved architectural blockers | GitHub Actions billing/spending configuration blocks required three-platform CI. | blocked |
| Credible migration policy | [ADR 0039](adr/0039-one-point-zero-compatibility-policy.md) defines explicit, transactional format migration. | ready |

## Reconsideration gate

Revisit the decision only after the open evidence is recorded without private
data, native CI passes on macOS, Linux, and Windows, and the release-readiness
criteria in `TODO.md` are satisfied. Do not infer recurring use, testimonial,
support, compatibility, or safety evidence from local tests alone.
