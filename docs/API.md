# API

## Runtime

- Backend: Go and PocketBase.
- Default address: `http://localhost:8090`.
- Frontend proxy: Vite forwards `/api` to the backend.
- OpenAPI JSON: `/openapi.json`.
- OpenAPI YAML: `/openapi.yaml`.
- ReDoc: `/docs`.

## Finance API

Finance routes are protected by the current PocketBase auth token and scope records to the signed-in owner.

For each finance resource, the server supports:

- `GET /api/finance/{resource}`
- `POST /api/finance/{resource}`
- `GET /api/finance/{resource}/{id}`
- `PATCH` or `PUT /api/finance/{resource}/{id}`
- `DELETE /api/finance/{resource}/{id}`

Resources are `accounts`, `transactions`, `checkpoints`, `budgets`, `assets`, and `goals`. Accounts also expose `GET /api/finance/accounts/{id}/summary`, which returns balance, cleared balance, reconciled balance, transaction count, checkpoint difference, and checkpoint windows. Checkpoints are immutable through normal updates and deletes; exceptional changes must include an explicit `confirm` query value.

The web adapter reads these collections and falls back to sample data when remote finance records are unavailable. Do not treat sample data as stored user data.

Unauthenticated finance requests return `401`.

## Extending the finance API

1. Define request and response types in the Go module.
2. Enforce auth, ownership, and permission checks in every route.
3. Define money and transfer validation before calculating balances.
4. Export OpenAPI with `pnpm generate:api`.
5. Generate the client with `pnpm generate:client`.
6. Add behavior tests at the pure-rule and API boundaries.

Never treat frontend visibility or sample-data fallback as authorization. Backend ownership checks are the enforcement point.
