# Piggybudget implementation status

## Implemented phases

- [x] Platform foundation: PocketBase runtime, auth, permissions, audit records, API generation, web shell, and backups.
- [x] Independent Piggybudget identity: Go module, command, workspace packages, Docker image, and preferred `PIGGYBUDGET_*` configuration prefix with legacy aliases.
- [x] Finance workspace: dashboard, transactions, budgets, assets, goals, settings, sample data, and PocketBase reads.
- [x] Finance persistence/API: owner-scoped collections, additive migration, protected CRUD routes, account summaries, ownership checks, and finance integration tests.
- [x] Reconciliation foundation: checkpoint windows, unexplained gap states, and immutable checkpoint mutations.
- [x] Quality baseline: focused server and client tests for the implemented foundation.

## Next work

- [ ] Move money, balance, transfer, reconciliation, and budget-allocation rules into a disjoint finance package.
- [ ] Add focused pure-rule tests for decimal, currency, sign, and rounding behavior.
- [ ] Replace sample fallback data with tested create/edit flows in the finance workspace.
- [ ] Add finance imports, reports, audit history, and end-to-end behavior tests.

## Scope note

Piggybudget is a finance product. The finance UI and protected API are real, while sample fallback and embedded money calculations stay visible in product claims. Starter task/calendar modules are not exposed as supported product workflows.

Keep schema changes additive: preserve applied PocketBase migrations and add a new migration for each schema change. Do not edit generated client output by hand.
