# Editor plugin

The optional Godot 4 plugin is a thin client. Copy
`editor-plugin/addons/wukong` into a Godot project's `addons/wukong` directory,
then enable **Wukong** in Project Settings → Plugins.

The dock detects `wukong` on `PATH`, or uses `WUKONG_EXECUTABLE` when set. It
only invokes `wukong status --json` and `wukong sync --json` with the explicit
project path; it has no package-resolution, lockfile, transaction, or source
handling logic. It streams CLI progress, displays structured diagnostics, lists
installed package identities, opens dependency-tree, outdated, and provenance
views, and selects the manifest or lockfile in Godot's FileSystem dock. Sync
results surface unknown or indeterminate Godot compatibility; ownership
conflicts are shown from the pre-mutation `sync` diagnostic.

Godot's documented `OS.execute_with_pipe` keeps the editor responsive while the
CLI runs and exposes separate stdout and stderr pipes. See the [Godot OS
documentation](https://docs.godotengine.org/en/stable/classes/class_os.html)
and [editor-plugin guide](https://docs.godotengine.org/en/stable/tutorials/plugins/editor/making_plugins.html).
