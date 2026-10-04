# Development

## Setup

```sh
pnpm install
cp .env.example .env
pnpm generate:api
pnpm generate:client
pnpm dev
```

Vite serves the web app on `5173`. Go and PocketBase serve the API on `8090`.

Profile data comes from the authenticated PocketBase user record (`display_name` and `email`). For local development only, set `VITE_USE_DEFAULT_PROFILE=true` to show the sample Alex Morgan profile instead. The flag is ignored in production builds.

## Checks

```sh
pnpm --filter @slopstack/web lint
pnpm --filter @slopstack/web build
pnpm --filter @slopstack/web test
go test ./...
```

The package and filter names still use `@slopstack/web`; they are current compatibility names.

## Finance feature workflow

1. Add or update the backend schema and a new migration.
2. Wire the schema into bootstrap and add protected API operations.
3. Export OpenAPI and regenerate the client.
4. Add pure finance rules before wiring UI calculations.
5. Keep sample fallback data separate from persisted user data.
6. Build finance UI from existing primitives.
7. Add behavior tests for the rules and API boundary.
8. Run client and server checks.

Generated output under `apps/web/src/api/generated` must not be edited manually. Do not modify `apps/web` or `apps/server/internal/app` when another agent owns those paths.
