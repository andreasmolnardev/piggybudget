# Piggybudget roadmap

Piggybudget is a personal finance app for accounts, transactions, budgets, assets, and goals. The first finance slice is implemented: the web workspace, owner-scoped storage, protected CRUD, account summaries, checkpoint windows, and tests are present.

## Implemented phases

### Phase 0: platform foundation — complete

- Embedded Go and PocketBase runtime.
- Auth, registration controls, password reset, verification, admin access, permissions, ownership, audit logs, and app passwords.
- React/Vite shell, generated API/client flow, deployment configuration, and backup tooling.

### Phase 1: finance workspace — complete as a UI slice

- Dashboard, transactions, budgets, assets, goals, and settings routes.
- Finance types and loaders for accounts, transactions, budgets, assets, and goals.
- Sample data fallback, summary metrics, transaction filtering, budget progress, asset totals, and goal progress.

The sample fallback is useful for an empty local account, but it can hide missing remote records. Keep that behavior out of claims about persisted user data.

### Phase 2: finance persistence and API — complete for the first slice

- Additive migration and owner-scoped collections for accounts, transactions, checkpoints, budgets, assets, and goals.
- Protected finance CRUD under `/api/finance/*` plus account summaries.
- Account-link validation, owner scoping, balance/cleared/reconciled summaries, and integration tests for auth and cross-user access.

The current calculations use the server app's record values. A separate money domain package with explicit decimal, currency, transfer, and rounding rules is still needed.

### Phase 3: reconciliation foundation — complete for the first slice

- Consecutive checkpoint windows with actual versus recorded deltas.
- Reconciled, incomplete, and invalid states.
- Immutable checkpoints with explicit confirmation for exceptional changes.
- Backups, restore tooling, and focused finance tests.

## Next phases

### Phase 4: finance rules and workflow depth

1. Move money, balance, transfer, reconciliation, and budget allocation into a disjoint finance package.
2. Add focused pure-rule tests for decimal precision, currency, signs, and rounding.
3. Replace sample fallback paths with tested create/edit flows in the finance workspace.
4. Add categories, budget periods, rollover rules, imports, reports, and audit history.

### Phase 5: product hardening

- Add browser end-to-end tests for finance CRUD, imports, reconciliation, budgets, and reports.
- Add offline/PWA behavior, queued edits, realtime updates, and conflict handling where finance workflows need them.
- Add account export and deletion flows.
- Keep non-finance starter modules out of the product surface unless the product scope changes.

## Current residue

The repository still contains unexposed starter task/calendar files and old package names from the template. They are not supported Piggybudget workflows; finance navigation, finance collections, and finance routes are the product surface.
