# Headless project validation

`wukong validate` is an opt-in project check. It never runs as part of `add`,
`remove`, `lock`, `install`, `sync`, or `update`.

```sh
wukong validate
wukong validate --project path/to/project
wukong validate --godot-executable /path/to/godot --timeout-seconds 120 --verbose
```

Wukong discovers Godot using the same precedence as `wukong godot path` and
starts it with the documented [Godot command-line flags](https://docs.godotengine.org/en/latest/tutorials/editor/command_line_tutorial.html):

```text
--headless --path <project> --editor --quit --recovery-mode
```

This checks editor project startup without starting the project game. Recovery
mode asks Godot to disable editor plugins, tool scripts, and GDExtensions during
startup. Wukong never forwards package-defined commands or scripts.

The default timeout is 60 seconds; `--timeout-seconds` accepts an integer from
1 through 600. On timeout Wukong stops the direct Godot process and returns a
failure. A child process that the operating system does not associate with that
process can require manual cleanup. Wukong does not write project files itself,
but Godot can update derived files under `.godot` while starting. Run validation
from a clean worktree and inspect generated-file changes before committing them.

Failures retain a structured outcome with exit status, elapsed time, and up to
64 KiB of combined stdout/stderr. Captured occurrences of the canonical project
path are replaced with `<project>`; `--verbose` prints this redacted output.
