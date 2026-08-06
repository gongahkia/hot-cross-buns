# ADR 0047: managed Godot toolchains

## Status

Accepted. This supersedes the installed-engine-only policy in
[ADR 0046](0046-native-cli-progress-and-godot-workflows.md).

## Context

An addon lockfile alone does not reproduce the editor used to run, validate,
or export a project. Requiring every developer and CI runner to separately
find and install a compatible editor makes Wukong less useful as the Godot
equivalent of a project toolchain manager.

The implementation must keep its existing safety properties: it must not run
package scripts, persist credentials, silently replace user installations, or
trust a mutable release reference. It also must remain usable during temporary
release-service outages for projects that do not opt into a managed engine.

## Decision

Wukong manages official stable desktop Godot releases from the fixed
`godotengine/godot-builds` GitHub repository. It supports the official
`standard` and `dotnet` families for macOS universal, Linux x86_64, Linux
aarch64, and Windows x86_64. Each release artifact is selected by its fixed
name, exact byte length, official HTTPS URL, and SHA-512 entry from the release
`SHA512-SUMS.txt` asset. Redirects remain HTTPS and within the approved
official GitHub release hosts.

`[toolchain]` optionally pins an exact stable version and flavor in
`wukong.toml`. Online `wukong lock` writes schema-four `wukong.lock` with the
exact selected release and all supported desktop editor artifacts, plus the
matching export-template artifact. This makes a committed lock portable across
supported developer and CI platforms. A project with no manifest pin selects
the latest compatible official stable release when release metadata is
available. A transient metadata failure emits a warning and retains a valid
existing toolchain, or leaves a legacy package-only lock unchanged; a new or
changed explicit pin remains an error.

Managed editors live outside the project and addon cache in a Wukong-owned
data root. Artifacts are re-hashed on every reuse, staged before extraction,
installed through atomic directory publication, and registered only after the
editor's stable `--version` output matches the locked version. Wukong enables
Godot self-contained mode in each managed install. It removes only an
installation whose Wukong metadata proves the requested identity.

The default `godot.downloads = "automatic"` allows project actions to download
a missing locked editor and export templates on demand. Users can set it to
`"manual"`; then Wukong reports the exact `wukong godot install` command
instead. `godot.executable`, `WUKONG_GODOT_EXECUTABLE`, and
`--godot-executable` remain supported user-managed overrides, but an override
that differs from `wukong.lock` needs `--allow-toolchain-override`.

`run`, `editor`, `export`, and `validate` use this order: explicit or
environment executable, explicit managed `--godot`, locked managed toolchain,
then configured/discovered external executable. Every selected executable is
checked against `[project].godot`; a locked toolchain additionally requires
the same exact version and flavor unless the explicit override flag is given.

The core emits phase and byte-count engine progress events. The CLI maps those
events to the existing configurable Rattles spinner and Wukong-owned progress
bars, and to protocol-v1 JSON Lines progress events. Terminal presentation is
never part of `wukong-core`.

## Consequences and alternatives

The lockfile schema changes from package-only schemas one through three to
schema four only when it records a managed toolchain. Older lockfiles remain
readable. A normal online lock can migrate an existing project; `--offline`
does not invent a toolchain. A schema-four lock captures four platform editor
artifacts, increasing lockfile size in exchange for cross-platform exactness.

Godot's download manager and a third-party mirror were rejected because they
would add another trust boundary and reduce the ability to verify immutable
release artifacts. Downloading only the current platform at lock time was
rejected because it would make the committed lock host-specific. Managing
arbitrary user-installed Godot distributions was rejected because it cannot
provide the same immutable provenance or safe deletion guarantee.

Managed installs intentionally do not update automatically. Users update an
unpinned toolchain with `wukong godot update`, or deliberately select a new
exact version with `wukong godot pin`.

## Migration and compatibility impact

Existing settings schema one is read and upgraded on the next settings write.
Existing user-managed executable configuration remains valid. The default
automatic setting only downloads after a project action selects a verified
schema-four locked toolchain; it does not scan, modify, or replace external
Godot installations.
