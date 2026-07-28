# Threat model

## Scope

This model covers the current Rust CLI and core library for local paths, Git,
and checksum-addressed HTTPS archives. It describes implemented controls and
residual risks; it is not a security guarantee or a substitute for a review.

## Assets

- Project-owned files, including unrelated Godot files and user edits.
- `wukong.toml`, `wukong.lock`, and `.wukong/state.toml` integrity.
- Reproducible source identities, checksums, and prepared package trees.
- Cache availability and integrity across projects.
- Git, HTTP, proxy, and system credential-manager secrets.
- CI execution environment and logs.

## Trust boundaries

| Boundary | Untrusted side | Current control |
| --- | --- | --- |
| Project input | Manifests, lockfiles, state, package metadata, and paths | Typed parsing, safe relative paths, deterministic serialisation, ownership checks. |
| Remote source | Git servers, HTTPS responses, redirects, and archives | Canonical immutable Git revisions; HTTPS-only archive URLs and declared SHA-256 verification. |
| Package content | Source trees and ZIP entries | Canonical package preparation; ZIP preflight and bounded staging extraction. |
| Shared cache | Existing cache entries and concurrent Wukong processes | Content-addressed verification, scoped advisory locks, and atomic publication. |
| System tooling | `git`, TLS roots, proxy configuration, and Godot executable | Argument-vector Git invocation, no shell, Rustls HTTP validation, explicit executable discovery. |
| Presentation | Diagnostics and logs | URL credential and sensitive-query redaction before rendering. |

## Attacker-controlled inputs

- CLI flags and relevant environment variables, including cache, proxy, and
  executable paths.
- Local project files, package source trees, cache entries, and lock files.
- Git URLs, selectors, repository responses, and Git command output.
- HTTPS URLs, redirect targets, response headers, and archive bytes.
- ZIP names, file types, sizes, compression ratios, and content.
- Package metadata and headless Godot output when validation is explicitly run.

## Security assumptions

- The operating system enforces filesystem permissions and advisory-lock
  lifetime, and atomic rename has the documented supported-platform semantics.
- The process's cache directory is not a hostile privilege boundary; a local
  actor with write access can cause denial of service or modify cache input.
- System Git, configured SSH, proxy, credential manager, and trusted TLS roots
  are within the user's administrative trust boundary.
- SHA-256 remains collision-resistant for content identity in this threat model.
- Users obtain Git revisions and archive checksums from a trusted channel.
- No package script is executed by Wukong; explicit Godot validation is a user
  request to execute the selected local executable.

## Implemented controls

- No arbitrary package install scripts or shell command construction.
- Archive extraction rejects traversal, symlinks, special files, duplicates,
  oversized inputs, and excessive expansion ratios before project mutation.
- Project sync validates conflicts, stages files, journals moves, publishes
  state last, and recovers incomplete transactions.
- Removal requires recorded ownership and a matching file hash.
- Lockfiles record immutable source identities; cache objects are re-verified
  before use.
- Cache maintenance preserves unrecognized entries and only deletes
  lock-proven package/archive objects.
- Diagnostics redact credentials and sensitive query values; URLs are not
  persisted in cache object paths.

## Residual risk

- A local attacker with project or cache write access can race operations,
  modify inputs, or deny service; locks mitigate cooperating Wukong processes,
  not malicious users.
- A pinned Git commit or user-supplied archive checksum proves identity/content,
  not publisher identity, author intent, or malware absence. Signatures are not
  implemented.
- System Git authentication, proxy behavior, and TLS trust roots remain outside
  Wukong's direct control.
- Resource limits currently focus on ZIP extraction; very large trusted Git
  repositories and permitted source trees can still consume disk, CPU, or time.
- Cross-platform filesystem behavior is tested on native macOS and a Windows
  compile target in this environment; Linux execution remains unverified here.
- An internal static review is recorded in
  [security-review-2026-07.md](security-review-2026-07.md). No independent
  external review is recorded in this repository, and release artifact signing
  remains outstanding. Parser and archive fuzzing are bounded and scheduled;
  they do not establish parser or extractor correctness.

## Security response

Report suspected vulnerabilities through the process in
[SECURITY.md](../SECURITY.md). Do not include credentials, private projects, or
exploit details in public issues.
