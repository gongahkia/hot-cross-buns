# Local paths

Local dependencies accept relative paths resolved against `wukong.toml` and
absolute paths. Paths outside the Godot project are supported. The adapter
requires an existing directory and canonicalises it, including root symlinks.

It derives an immutable `sha256:` source revision from a sorted content walk.
Files, directories, and literal symlink targets are hashed; symlinks are not
followed. `.git` and caller-configured names are ignored at every depth. See
[ADR 0006](adr/0006-local-path-snapshot.md).
