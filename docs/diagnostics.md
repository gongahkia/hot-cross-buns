# Diagnostics

`wukong-core` returns structured diagnostics. The CLI owns human-readable
rendering and process exit codes.

## Error categories and exit codes

| Category | Exit code | Meaning |
| --- | ---: | --- |
| Success | 0 | The command completed successfully. |
| User | 2 | Arguments, manifest, project state, or requested operation are invalid. |
| Source | 3 | A package source could not be accessed or interpreted. |
| Integrity | 4 | Content failed a required integrity check. |
| Internal | 70 | An unexpected internal failure occurred. |

## Human-readable output

Default output identifies the error code and summary, package and source when
known, project modification state, rollback result, and a recovery action when
available. Verbose output additionally includes the causal error text.

Source user information, sensitive query values, and common authentication or
cookie header values are redacted before they are stored in diagnostics or
rendered. Raw backtraces are not part of default output.
