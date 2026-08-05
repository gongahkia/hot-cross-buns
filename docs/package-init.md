# `wukong package init`

Create required package metadata in an existing addon directory:

```sh
wukong package init
wukong package init --path path/to/addon
wukong package init --path path/to/addon --name example-addon --version 1.2.3 --godot '>=4.3,<5'
```

With no `--path`, the current directory is the package root. The default name
is its canonical directory name; it must already be a valid package name. The
default version is `0.1.0`, and the default Godot requirement is `>=4.0,<5`.
`root` and `target` are omitted unless explicitly supplied.

`--name`, `--version`, `--godot`, `--root`, and `--target` use the same
validation as [package metadata](package-metadata.md). The command parses the
generated file before atomically creating `wukong-package.toml`. It never
overwrites an existing file, including a symlink. It does not fetch sources,
read a project manifest, or run package scripts.
