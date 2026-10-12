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
Run the API with `PIGGYBUDGET_DEVELOPMENT=true` to enable guest sign-in and
one-time preview data for new users. Preview records are stored in PocketBase
and use the same finance API as other records, so they can be edited and
deleted normally. The web app does not substitute local sample data when the
API is unavailable.

Profile data comes from the authenticated PocketBase user record (`display_name` and `email`). For local development only, set `VITE_USE_DEFAULT_PROFILE=true` to show the sample Alex Morgan profile instead. The flag is ignored in production builds.

## Checks

`pnpm check` runs lint, tests, and the production build. You can also run each
step on its own:

```sh
pnpm check
pnpm test
pnpm build
pnpm --filter @piggybudget/web lint
pnpm --filter @piggybudget/web build
pnpm --filter @piggybudget/web test
go test ./...
```

Use `pnpm generate` to export the API and regenerate the typed web client.

The Go module is `github.com/piggybudget/piggybudget`, and the web package is `@piggybudget/web`.

Piggybudget pins the released Slopstack runtime v0.3.0 without a sibling-path
`replace`. Shared packages provide auth and permission helpers, audit recording,
ownership hooks, Huma and OpenAPI HTTP wiring, backup adapters, and encryption.
Piggybudget retains its finance schemas, routes, operations, and UI. Update the
runtime explicitly with `go get github.com/andreasmolnardev/slopstack@<version>`.

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
