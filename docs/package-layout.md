# Package layout

An explicit source subdirectory wins and must stay below the source root. An
optional target path is retained for later installation and must be relative.

Without an override, `wukong` selects a single `addons/<name>` child. Multiple
children are an error with all candidates listed. A sole wrapper directory is
unwrapped before applying the same rules. If there is no `addons/` directory,
the source root is used. `plugin.cfg` is not required because runtime addons
may not be editor plugins. See [ADR 0008](adr/0008-package-layout-detection.md).
