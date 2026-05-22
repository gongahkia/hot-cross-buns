# Hot Cross Buns 2

Electron-first rebuild of Hot Cross Buns.

Start with [docs/README.md](docs/README.md) before changing product, architecture, security, or subsystem behavior.

## Local Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test:unit
pnpm test:smoke
```

The current app scaffold is Electron + React + TypeScript + Vite with an unprivileged renderer and a narrow preload API.
