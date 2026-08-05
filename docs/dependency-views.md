# Dependency views

`wukong tree` and `wukong why <package>` inspect the last resolved
`wukong.lock`. Schema-three catalog graphs use their persisted `[roots]` table
and derived group closure, so these commands do not read `wukong.toml` for that
graph. Schema-one and schema-two locks retain manifest-derived root groups.
They are read-only: they do not resolve, fetch, execute scripts, or modify
project files.

```text
$ wukong tree
runtime dependencies:
├── alpha@1.0.0 [direct]
│   └── shared@1.0.0 [transitive]
└── beta@1.0.0 [direct]
    └── shared@1.0.0 [transitive] [repeated]

development dependencies:
└── dev-tool@1.0.0 [direct, development]

$ wukong why shared
why shared:
alpha -> shared
beta -> shared
```

Repeated subgraphs display once and are subsequently marked `[repeated]`.
Hand-edited cyclic lockfiles are compactly marked `[cycle]`; `why` returns only
simple root-to-package paths so traversal remains finite.

## JSON

Pass `--json` to either command. The output has `schema: 1` and deterministic
canonical package-name order. `tree` includes root groups and package records;
`why` includes the target and every root-to-target path. Schema-three package
records include direct runtime/development flags plus derived runtime and
development-only membership.

Both commands accept `--project <path>` to select a Godot project directory or
`project.godot` file.
