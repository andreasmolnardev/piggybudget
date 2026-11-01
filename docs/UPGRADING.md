# Upgrading Piggybudget

## Existing databases

The Slopstack primitive migration does not change the PocketBase schema or the
finance API contract. It adds frontend resource, view, layout, auth, settings,
form, data-view, query, search, and action adapters around the current
Piggybudget workflows. No collection or field is renamed or dropped, and this
change adds no PocketBase migration.

An existing installation continues to use the same `pb_data` directory (or the
same directory configured by `PIGGYBUDGET_STORAGE_PATH`). The new server opens
that database in place, retains all records and collection IDs, and applies any
unapplied forward migrations from the existing migration registry. The full
historical Taskboard-lineage and Piggybudget migration files remain registered
in order through `20261027100000_add_budget_rollover_policies.go`. The app does
not copy data into a new database or seed over existing records.

## Upgrade a running installation

1. Stop the old Piggybudget process.
2. Create a backup with the old installation's `piggybudget backup create`
   command, or take a consistent copy of its configured PocketBase data and
   backup directories.
3. Deploy the new Piggybudget image or binary with the same persistent volume
   and `PIGGYBUDGET_STORAGE_PATH` value.
4. Start Piggybudget and check that the existing user can sign in and see their
   accounts, transactions, budgets, assets, and goals.

The old backup import path is still supported. To import an archive made by an
older Piggybudget release, place it in the configured backups directory and run
`piggybudget backup restore <exact-archive-name> --confirm` with the target
storage path configured. The restore command retains its restart guard; after
PocketBase restores the archive, the restarted server applies its current
forward migrations. The historical populated archive in
`apps/server/testdata/piggybudget-eb40d62-populated.zip` is exercised by
`pnpm test:compatibility` against disposable directories.

## Rollback

This frontend migration has no database rollback step because it adds no schema
or record conversion. If the new process cannot serve the existing database,
stop it and redeploy the previous Piggybudget release against the same data
volume. Keep the pre-upgrade backup until the new release is confirmed healthy.
For a later release that adds a schema migration, use a backup made before that
release if rolling back to a binary that cannot read the newer schema; do not
restore an archive over a live database.

## Compatibility boundaries

The finance UI still uses Piggybudget's domain workflows for transfers,
reconciliation, transaction splits and attachments, recurring activity,
obligations, budget rollover, and asset and goal history. The generic Slopstack
form and data-view primitives are used for account editing and account
management; they do not replace those workflows or change stored formats.
TanStack Router remains the renderer for the current finance screens. The
Slopstack view registry supplies route and access metadata, while the existing
workspace components continue to render the finance pages.
