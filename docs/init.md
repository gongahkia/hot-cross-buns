# `wukong init`

Run from a Godot project, or provide an explicit project directory or
`project.godot` file:

```sh
wukong init
wukong init --project path/to/project.godot --non-interactive
```

The command discovers the project root, infers the name from
`[application] config/name` when it is a supported Godot string, and otherwise
uses the project directory name. It creates this deterministic minimal manifest:

```toml
[project]
name = "my-game"
godot = ">=4.0,<5"
```

`init` has no prompts, so `--non-interactive` is accepted for CI and has the
same result as the default invocation.

Creation is transactional: `wukong` writes and syncs a sibling temporary file,
then publishes it atomically without replacement. An existing `wukong.toml`,
including a symlink, is always refused and remains unchanged. Project
filesystems must support hard links; otherwise `init` fails with a recoverable
diagnostic and creates no manifest.
