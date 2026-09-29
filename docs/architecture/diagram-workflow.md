# Architecture Diagram Workflow

The current architecture diagram is a repository artifact. It must remain accurate in every clone and in GitHub-rendered documentation; it does not depend on Draw.io Desktop, a locally installed MCP server, or a particular developer machine.

## Source of truth and generated files

Edit only [hot-cross-buns-architecture.json](hot-cross-buns-architecture.json). It describes the systems, trust boundaries, external dependencies, and numbered request/data flows.

The generator creates two checked-in outputs:

- [hot-cross-buns-current-architecture.drawio](hot-cross-buns-current-architecture.drawio) — editable in Draw.io / diagrams.net.
- [../assets/hot-cross-buns-current-architecture.svg](../assets/hot-cross-buns-current-architecture.svg) — the preview embedded in the root README.

Do not hand-edit either generated file. A generated-file header makes this explicit.

## When an architecture review is required

Update the model whenever a change affects any of these boundaries:

- renderer, preload API, IPC contracts, or the Electron main process;
- a domain service, persistence responsibility, local cache/outbox, or credential handling;
- OAuth, synchronization, polling, external browser flows, or a Google API scope/integration;
- a newly supported network service, worker, listener, hosted backend, or security boundary;
- a supported service being removed or becoming dormant.

Normal component styling and isolated feature behavior do not require a diagram change. When in doubt, review the model and retain or update it deliberately.

## Update flow

1. Implement the architecture change and update its supporting documentation/tests.
2. Update `docs/architecture/hot-cross-buns-architecture.json` so its nodes, numbered flows, and boundary note match the running application.
3. Regenerate both artifacts from the repository root:

   ```sh
   corepack pnpm architecture:generate
   ```

4. Open the `.drawio` output in Draw.io or inspect the README SVG, then commit the model and both generated files together.
5. Before opening a pull request, verify that generated output is current:

   ```sh
   corepack pnpm architecture:check
   ```

## CI enforcement

The `Architecture diagram` GitHub Actions job runs `architecture:check` on every push and pull request. It fails if the source model and its checked-in Draw.io/SVG artifacts disagree.

For pull requests that alter an architecture-sensitive runtime boundary, CI also requires a deliberate architecture-model review. That prevents a main-process, preload, sync, credential, or integration change from silently bypassing the diagram. If the architecture is unchanged, update the model's `lastReviewed` date and regenerate the artifacts; if it changed, represent the change and regenerate the artifacts.
