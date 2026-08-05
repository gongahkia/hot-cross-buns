# Godot compatibility enforcement

Wukong records each locked package's required Godot requirement from
`wukong-package.toml`. Before `lock`, `sync`, `add`, `remove`, or `update`
publishes changed state or modifies project files, it validates every newly
locked package requirement against the project compatibility input.

With `--godot <x.y.z>`, every known package requirement must match that exact
active engine version. Without it, Wukong proves that stable versions allowed by
`[project].godot` and each package requirement overlap. A proven empty overlap
is an error before mutation.

Requirements with pre-release comparators are reported as needing an exact
`--godot` version rather than being inferred. Legacy lockfiles may still report
`unknown`, but they cannot be refreshed without required package metadata.
