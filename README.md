# Jing

This repository contains the React frontend only. It does not include a database, API server, authentication service, calendar proxy, or server-side backup implementation.

## Development

```sh
npm install
npm run dev
```

With no data source configured, the application starts in an explicit unconnected state. To connect an HTTP service, copy `.env.example` to `.env.local` and set:

```sh
VITE_API_BASE_URL=https://example.com/api
```

The existing UI request contract is centralized in `src/api.ts`. Transport selection lives in `src/dataSource.ts`; call `configureDataSource()` before rendering to install a non-HTTP adapter.

## Data model

Jing does not reduce everything to one TODO file. The frontend renders a journal response with two main collections:

- `tasks`: active to-dos shown in the task outline.
- `days`: dated journal pages whose `entries` can be notes or completed tasks, plus focus sessions and calendar events.

`src/types.ts` defines that contract; it is not a storage file. UI components call the domain helpers in `src/api.ts`, which normalize responses and pass requests to the adapter in `src/dataSource.ts`. The default adapter talks to `VITE_API_BASE_URL`. A host application can instead install its own adapter with `configureDataSource()` before React renders.

Only UI preferences, editing drafts, and undo metadata are stored in browser `localStorage`. Journal entries and tasks need to be supplied by the configured data source.

## Build

```sh
npm run build
npm run preview
```

Vite writes the static application to `dist/`. Any static hosting provider can serve that directory.
