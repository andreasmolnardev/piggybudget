# Piggybudget

Piggybudget is a personal finance app for seeing accounts, transactions, budgets, assets, and goals in one place.

The current implementation has a working first finance slice: finance collections, protected CRUD routes, account summaries, a finance workspace, and tests. Some web views still use sample fallback data, and the money rules are not yet a separate domain package.

## Implemented phases

### Phase 0: platform foundation

- Go runtime with embedded PocketBase storage.
- User auth, registration controls, password reset, email verification, and admin access.
- Ownership checks, permissions, audit records, app passwords, and generated API/client workflows.
- React/Vite application shell and deployment/backup tooling.

### Phase 1: Piggybudget workspace

- Dashboard, transactions, budgets, assets, goals, and settings routes.
- Finance data types and PocketBase reads for accounts, transactions, budgets, assets, and goals.
- Useful sample data when remote finance records are not available.
- Summary cards, filters, account views, budget progress, asset totals, and goal progress.

### Phase 2: finance persistence and API

- Owner-scoped collections for accounts, transactions, checkpoints, budgets, assets, and goals.
- Additive finance migration with fields and indexes.
- Protected finance CRUD routes under `/api/finance/*` and the account summary endpoint.
- Ownership/link validation and server tests for schema, balance/reconciliation summaries, auth, and cross-user access.

### Phase 3: finance workflow foundation

- Server-side checkpoint windows with unexplained gap states.
- Explicit checkpoint confirmation for exceptional edits or removal.
- Budget, asset, goal, and transaction fields that keep financial movement in one ledger.
- Scheduled backups, manual restore tooling, and focused finance tests.

## Next product phases

1. Move money, balance, transfer, reconciliation, and budget-allocation rules into a disjoint finance package.
2. Add focused pure-rule tests with explicit decimal, currency, and rounding behavior.
3. Replace sample fallback paths with tested create/edit flows in the finance workspace.
4. Add imports, reports, audit history, offline behavior, and finance end-to-end tests.

The starter task/calendar modules are not part of the Piggybudget product surface. Piggybudget exposes finance navigation and finance API routes only; those old modules are not a supported user workflow.

## Development

```sh
pnpm install
pnpm generate:api
pnpm generate:client
pnpm test
go test ./...
```

The current package, binary, and environment variable names still use `slopstack`. They are compatibility names and have not been renamed as part of the Piggybudget work.

See [`PATCH.md`](./PATCH.md), [`ROADMAP.md`](./ROADMAP.md), and [`docs/`](./docs/) for the implementation status and engineering notes.
