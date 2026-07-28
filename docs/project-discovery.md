# Project discovery

A Godot project root is the directory containing a regular `project.godot`
file. This matches Godot's project import model, which accepts either the
project directory or its `project.godot` file.

Commands that support `--project <path>` accept either form and do not search
upward from the working directory. Without that option, discovery starts at the
working directory and selects the nearest ancestor project root. Nested Godot
projects are therefore deterministic: the innermost root wins.

On Unix, upward discovery stops after checking the current directory when its
parent is on a different filesystem device. On non-Unix systems it always stops
at the filesystem root; mount-point boundary detection is not yet available
through the Rust standard library.
