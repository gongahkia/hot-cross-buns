# ADR 0008: package-layout detection

## Status

Accepted

## Context

Local repositories and archives package Godot addons in several layouts. An
incorrect automatic choice could materialise unrelated files or install the
wrong addon.

## Decision

Accept optional explicit source-subdirectory and target-path inputs. The source
subdirectory must be a safe relative path beneath the source root; it always
wins. The target path is retained as metadata for later materialisation and
must also be a safe relative path.

Without an override, inspect the source root conservatively. A root-level
`addons/` directory containing exactly one child directory selects that child.
More than one child is an ambiguity and reports all candidate paths. A wrapper
directory is unwrapped only when it is the sole visible root entry, then the
same rules are applied inside it. If no `addons/` directory exists, the source
root itself is the addon. No directory is selected merely because its name
looks plausible.

`plugin.cfg` is useful Godot editor-plugin metadata but is not required for
layout inference: runtime addons may not contain it. Package metadata can
provide an explicit root later.

## Consequences

The detector does not guess among multiple addons. The selected source root and
optional target are deterministic layout metadata; copying and target mapping
remain deferred. Wrapper detection ignores only known source-control and OS
metadata names.

## Alternatives considered

- Require `plugin.cfg`: rejected because it excludes non-editor addons.
- Choose the first `addons/*` child: rejected because filesystem ordering is
  nondeterministic and could install an unintended addon.
- Recursively search all directories: rejected because it guesses repository
  intent and can select unrelated examples or tests.

## Migration and compatibility impact

`wukong-package.toml` may supply an explicit root in W032. New implicit rules
require a replacement ADR because they can change installed file sets.
