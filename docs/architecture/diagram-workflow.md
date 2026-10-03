# Architecture Diagram Workflow

The current architecture diagram is generated with the Python `diagrams-as-code` package and its `diagrams` renderer, backed by Graphviz. It is checked into the repository so it renders in GitHub documentation without Draw.io or a local service.

## Source and output

Edit [../../scripts/generate_architecture_diagram.py](../../scripts/generate_architecture_diagram.py), then generate [../assets/hot-cross-buns-architecture.png](../assets/hot-cross-buns-architecture.png). Do not edit the PNG directly.

The generator uses the app's checked-in Google Calendar and Google Tasks assets, plus checked-in Electron, Google Cloud, and SQLite marks in [../assets/architecture-icons](../assets/architecture-icons). The Electron mark comes from [Electron's official site](https://www.electronjs.org/assets/img/logo.svg), the Google Cloud mark comes from [Google Cloud's official favicon asset](https://www.gstatic.com/cgc/supercloud_favicon.ico), and the SQLite mark comes from the [official SQLite source mirror](https://github.com/sqlite/sqlite/blob/master/art/sqlite370.jpg).

The generator requires Python 3.11, Graphviz, and the dependency pinned in `requirements-architecture.txt`. `uv` provisions the compatible interpreter and isolated dependency environment automatically.

## When to update it

Review and update the Python generator whenever renderer/preload/IPC boundaries, privileged services, persistence, credentials, OAuth, sync, or external integrations change. Do not add an HCB cloud backend, Vault/hoster endpoint, or enabled local MCP listener to the diagram: none exists.

## Commands

```sh
corepack pnpm architecture:generate
corepack pnpm architecture:check
```

Commit the generator, icon assets, and generated PNG together. CI runs the check on every push and pull request and requires a generator review for architecture-sensitive changes.
