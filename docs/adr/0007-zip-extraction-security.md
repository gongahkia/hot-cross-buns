# ADR 0007: ZIP extraction security policy

## Status

Accepted

## Context

Untrusted archives can escape a staging directory, consume unbounded resources,
or create filesystem objects unsafe for later materialisation. The initial
format is ZIP only.

## Decision

Use `zip` 7.2.0 with default features disabled and the pure-Rust deflate
backend. It is MIT licensed, supports Rust 1.83+, and exposes ZIP entry metadata
needed for explicit validation.

Preflight every ZIP entry before writing any output. Reject a raw name with an
absolute path, traversal, NUL, Windows drive or UNC prefix, or an invalid
enclosed path. Reject symlinks and non-directory, non-regular entry types;
hardlinks are unsupported by ZIP and remain rejected by policy. Enforce fixed
file-count, expanded-byte, and expansion-ratio limits before extraction.

Extract only into a caller-created staging root. Every output path is checked
against that root. On any error remove the entire staging root created for the
operation. Archive extraction never commits project files.

## Consequences

Archives with symlinks, special files, or unavailable compression methods fail
instead of being partially interpreted. TAR and other formats remain deferred.
Callers may choose tighter limits but cannot disable safety limits.

## Alternatives considered

- Use `ZipArchive::extract`: rejected because it overwrites existing paths and
  is not transactional.
- Follow contained symlinks: rejected because a later write can race or escape
  through a filesystem link.
- Enable every ZIP compression backend: rejected because unused parsers enlarge
  the attack surface and add native dependencies.

## Migration and compatibility impact

Future archive formats require their own extraction policy or a replacement
security ADR. Limits may become configurable only within the minimum-safe
bounds defined by this policy.
