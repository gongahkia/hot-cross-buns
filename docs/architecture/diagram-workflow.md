# Architecture Diagram Workflow

The current architecture diagram is generated with the Python `diagrams-as-code` library and Graphviz. It is checked into the repository so it renders in GitHub documentation without Draw.io or a local service.

## Source and output

Edit [hot-cross-buns-architecture.yaml](hot-cross-buns-architecture.yaml), then generate [../assets/hot-cross-buns-architecture.png](../assets/hot-cross-buns-architecture.png). Do not edit the PNG directly.

The generator requires Python 3.11, Graphviz, and the dependency pinned in `requirements-architecture.txt`. `uv` provisions the compatible interpreter and isolated dependency environment automatically.

## When to update it

Review and update the YAML whenever renderer/preload/IPC boundaries, privileged services, persistence, credentials, OAuth, sync, or external integrations change. Do not add an HCB cloud backend, Vault/hoster endpoint, or enabled local MCP listener to the diagram: none exists.

## Commands

```sh
corepack pnpm architecture:generate
corepack pnpm architecture:check
```

Commit the YAML source and generated PNG together. CI runs the check on every push and pull request and requires a YAML review for architecture-sensitive changes.
