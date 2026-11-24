# Extensions

**Interface status:** Hot Cross Buns runs as a local browser app (`make run`). Shell examples below are source-checkout developer operations with an explicit internal opt-in; see [development instructions](DEVELOPMENT.md). They do not install or enable a public CLI.

Hot Cross Buns extensions add reusable prompt guidance, skills, and optional executable
tools to native Hot Cross Buns runs. There is one lifecycle:

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension install /path/to/extension
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension install https://github.com/example/review-helper.git
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension list
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension disable extension-id
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension enable extension-id
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns extension remove extension-id --yes
```

Installed bundles live below `$XDG_DATA_HOME/hot-cross-buns/extensions/` (or
`~/.local/share/hot-cross-buns/extensions/`). The non-secret enabled state is in the
single Hot Cross Buns configuration file, `$XDG_CONFIG_HOME/hot-cross-buns/config.json`. An
installation is enabled immediately; replacement requires `--replace`, and
removal requires `--yes`.

`install` accepts a local directory or an explicit `https`, `ssh`, or `git@`
repository URL. Git sources are cloned shallowly only for that explicit
installation; re-run the same command with `--replace` to update an installed
package. Hot Cross Buns never refreshes executable extension code in the background.

## Project extensions and trust

A repository can keep extensions at:

```text
.hot-cross-buns/extensions/<extension-id>/hot-cross-buns-extension.json
```

They do nothing until the developer runs `hot-cross-buns extension trust` from that Git
checkout. Trust records the canonical repository path and a SHA-256 hash of the
entire extension bundle: any manifest, prompt, executable, helper, or file-mode
change disables the project bundle until it is reviewed and trusted again. Use
`hot-cross-buns extension status` to inspect that state and `hot-cross-buns extension untrust` to
revoke it. This is deliberate: cloning or opening a repository must not make
its files executable merely because Hot Cross Buns starts a task there.

## Manifest

Every bundle has a `hot-cross-buns-extension.json` file:

```json
{
  "version": 1,
  "id": "review-helper",
  "name": "Review helper",
  "skills": ["skills/review.md"],
  "prompts": ["prompts/team-style.md"],
  "commands": [
    {
      "name": "focused_review",
      "description": "Load the focused review prompt into the composer.",
      "prompt": "prompts/focused-review.md"
    }
  ],
  "ui": [
    {
      "id": "review_checklist",
      "slot": "review",
      "title": "Team review checklist",
      "description": "Check exported API impact and regression coverage.",
      "prompt": "prompts/review-checklist.md"
    }
  ],
  "tools": [
    {
      "name": "lookup",
      "description": "Look up a reviewed internal convention.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["topic"],
        "properties": {"topic": {"type": "string"}}
      },
      "command": ["bin/lookup"],
      "timeout_seconds": 30
    }
  ]
}
```

IDs use lower-case letters, digits, and hyphens. Resource and command paths
are exact relative paths—no globs, absolute paths, symlinks, implicit startup
hooks, or shell command strings are accepted. Skill and prompt files must be
`.md` or `.txt` files. Hot Cross Buns places their contents in the native model’s system
guidance with the extension ID shown.

Extension tools are available only in Execute mode and appear to the model as
`extension_<extension-id>_<tool-name>`. Their declared parameter schema is
passed through to the direct model adapter.

Legacy extension-command prompt metadata is still parsed for installed-bundle
compatibility, but the main Hot Cross Buns TUI does not add extension-specific commands
to its composer. A future Work-native prompt template must enter through the
same visible main-Hot Cross Buns send boundary; it must not revive a Code-only palette.

## Retired Code UI metadata

The extension schema may contain up to sixteen static `ui` cards for backward
compatibility with the retired Code frontend. The main Hot Cross Buns TUI deliberately
does not render those cards or expose the old `/extensions` and review-panel
entry points. Installed bundles therefore cannot add user-facing UI today.

This remains deliberately unlike a plugin webview API: manifests cannot supply
JavaScript, CSS, arbitrary key handlers, HTTP routes, subprocesses, or dynamic
rendering code. Executable behavior continues to require an explicit `tools`
declaration, existing bundle trust, a per-run `extension` grant to internal
Code, and the sandboxed, approval-gated sidecar boundary.

## Sidecar tool protocol

An executable tool receives one JSON object on standard input and emits exactly
one JSON object on standard output. Hot Cross Buns invokes the command with argv, never
a shell, from the isolated worktree. A representative request is:

```json
{
  "version": 1,
  "method": "tool",
  "extension": "review-helper",
  "tool": "lookup",
  "arguments": {"topic": "migrations"},
  "repository": "/path/to/isolated-worktree",
  "worktree": "/path/to/isolated-worktree"
}
```

The required response is:

```json
{"content":"Use a reversible migration and test downgrade behavior."}
```

Tool responses are limited to 64 KiB and commands to two minutes (or a shorter
manifest timeout). Every model-requested sidecar invocation requires the same
allow-once, allow-this-exact-tool, or deny approval used for trusted MCP tools.
The executable runs under the native run's strict sandbox, filesystem roots,
filtered environment, and network mode; `--sandbox off` remains the explicit
host-access escape hatch for the entire run. A malformed response, nonzero
exit, timeout, or post-load bundle change fails the tool call visibly.

## Trust boundary

An executable extension is code selected by the developer. Global extensions
require an explicit local install; project extensions require explicit
hash-pinned trust. Neither bypasses the native run's process sandbox or the
per-tool developer approval boundary. Extension sidecars can write only where
the run sandbox already permits writes; any resulting worktree change remains
subject to Hot Cross Buns's final diff, verifier, and explicit patch handoff review.
Hot Cross Buns rejects symlinks and non-regular files in every extension bundle, and
rehashes a bundle before reading its guidance or launching its sidecar.
