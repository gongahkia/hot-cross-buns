# Godot compatibility enforcement

Wukong records a package's Godot requirement from its optional
`wukong-package.toml` in `wukong.lock`. Before `lock`, `sync`, `add`, `remove`,
or `update` publishes changed state or modifies project files, it validates
known package requirements against the project compatibility input.

With `--godot <x.y.z>`, every known package requirement must match that exact
active engine version. Without it, Wukong proves that stable versions allowed by
`[project].godot` and each package requirement overlap. A proven empty overlap
is an error before mutation.

Packages without metadata are reported as `unknown` and do not block the
operation. Requirements with pre-release comparators are reported as needing an
exact `--godot` version rather than being inferred. This keeps unknown and
indeterminate compatibility distinct from confirmed compatibility.
