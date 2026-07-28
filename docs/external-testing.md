# External testing

This ledger distinguishes verified fixture evidence from feedback supplied by
external people. It must not be used to imply endorsement, usage, or
compatibility beyond the recorded test result.

## Public repository cases

The fixture corpus contains these unrelated public repositories at immutable
revisions. Wukong records only fixture metadata; it does not vendor source
content. Before adding a new case, review the source licence and access terms
under the [fixture process](fixture-guide.md#compatibility-corpus-process).

| Fixture | Immutable source | Revision | Target path |
| --- | --- | --- | --- |
| `godot-input-helper` | `https://github.com/nathanhoad/godot_input_helper.git` | `ccfad58f7eea997e3d4f0903dcac9212da2b2208` | `addons/input_helper` |
| `godot-game-settings` | `https://github.com/PunchablePlushie/godot-game-settings.git` | `79a996d8f7310f30a2651e058acddef9d4819b43` | `addons/ggs` |
| `quest-manager` | `https://github.com/Rubonnek/quest-manager.git` | `8fe88bc8a415d0b57e32a11b6114518e6d62ff6d` | `addons/rubonnek.quest_manager` |

Their complete reproducible metadata is in
`fixtures/compatibility/v1/{godot-input-helper,godot-game-settings,quest-manager}.toml`.
The [compatibility-fixture validation record](compatibility-fixtures.md#w084-validation-record)
records the last source-verification result.

## Onboarding ledger

No external tester has been recruited or run an onboarding session. Therefore
there is no external friction, critical-failure, or testimonial record yet.
Do not convert this absence into a successful test result.

For every external session, record:

- anonymised tester or repository reference, with consent status;
- operating system, Godot version, and Wukong version;
- exact manifest and safe lockfile, or a minimal reproducer;
- intended workflow, observed friction, and outcome;
- diagnostic output with credentials removed;
- issue link and resolution commit for each critical failure; and
- a testimonial only when the author supplied it and approved its use.

Do not include private repository URLs, credentials, unredacted logs, or
tester-identifying information without explicit permission.

## Reproducing a public fixture

Prepare exact source checkouts manually, then run the opt-in verifier without
network access or package-script execution:

```text
WUKONG_COMPATIBILITY_SOURCES=/absolute/path \
  cargo test -p wukong-core --test compatibility_fixture -- --ignored
```

See [Compatibility fixtures](compatibility-fixtures.md) for directory layout
and verification scope.
