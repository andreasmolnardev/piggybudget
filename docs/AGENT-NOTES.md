# Agent Notes — Piggybudget migration

Short, hard-won context for whoever picks this up. Companion docs:
`ARCHITECTURE.md`, `COMPATIBILITY.md`, `EXTRACTION-INVENTORY.md`, `baseline.json`.

## 1. There is no git remote

`git remote -v` returns nothing. **Nothing in this repo has ever been pushed
anywhere.** There is no other copy.

Consequences:

- Any commit not made is gone on disk failure. Commit early and often.
- Untracked files are gone with no recovery.
- This was still true at the Phase 0 baseline (`docs/baseline.json`
  → `vcs.remotes: []`, `vcs.commits_at_baseline: 7`).

**Phase 0 deliberately did not add a remote.** That is a decision for the owner.

Also: git reports `too many unreachable loose objects` and a stale `.git/gc.log`.
Harmless, but `git gc` should be run at some point by someone who has decided
where this repo actually lives.

## 2. Module identity was wrong everywhere (resolved in Phase 1)

The module and app package names now use Piggybudget's identity.

| Thing | Current | Should be |
|---|---|---|
| `go.mod` module | `github.com/slopstack/slopstack` | `github.com/piggybudget/piggybudget` |
| web package | `@slopstack/web` | `@piggybudget/web` |
| root package | `slopstack` | `piggybudget` |
| env vars | `SLOPSTACK_*` | `PIGGYBUDGET_*`, with deprecated aliases |
| binary dir | `apps/server/cmd/slopstack` | `apps/server/cmd/piggybudget` |
| docker image | `slopstack` | `piggybudget` |

`pb.RootCmd.Use` and the build paths now use `piggybudget`.

Review upstream Slopstack imports when adopting shared packages; Piggybudget now
has a distinct module path.

`PIGGYBUDGET_*` settings take precedence, with `SLOPSTACK_*` aliases for
existing deployments. The default storage path and Compose volume stay stable.

Stray Taskboard identity still in the product path:

- `apps/web/src/theme.ts:1` — localStorage key `taskboard-custom-theme`, plus a
  `taskboard-custom-theme-change` event. Changing the key silently discards every
  user's saved theme; treat it as a migration, not an edit.
- `apps/server/internal/app/guest_auth.go:9` — guest email `guest@taskboard.local`.
- `apps/server/internal/app/caldav.go:43` — `WWW-Authenticate: Basic realm="Taskboard CalDAV"`.

## 3. Inherited Taskboard code, verified unused

Full evidence in `ARCHITECTURE.md` §7 and `EXTRACTION-INVENTORY.md` §4. Summary:

**Server (wired into the running server, no Piggybudget caller):**

```
internal/app/caldav.go           854 LOC
internal/app/caldav_xml.go       139
internal/app/caldav_changes.go   152
internal/app/carddav.go          333
internal/app/calendar_io.go      596
internal/app/occurrences.go      480
internal/app/search.go           292
internal/calendar/recurrence.go  187
```

Plus partially-obsolete halves of `schema.go` (12-collection table),
`ownership.go` (hooks for todos/events/lists/calendars/contacts),
`authorization.go` (whole file — a stub with no group lookup at all), and
`app.go`'s `provisionDefaultContainers` (app.go:52-53 says in a comment it exists
only to keep DAV tests passing).

**Web (unreachable from `main.tsx`):** `components/tabs/*`, `components/time-grid/*`,
`components/container-manager/*`, `calendar-month.tsx`, `full-month-calendar.tsx`,
`entry-row.tsx`, `create-fields.tsx`, `create-composer.tsx(+helpers)`,
`notifications-popover.tsx`, `data.ts`, `theme.ts`, `hooks/use-mobile.ts`,
`api/generated/**`.

### How to re-verify

The module-graph walk from `apps/web/src/main.tsx` is the authoritative check for
the web side. `scripts/baseline-check.mjs` reimplements it and reports the
reachable count; it currently reports **15**. If that number changes, the audit
inventory is stale.

```
node scripts/baseline-check.mjs        # -> "no drift from docs/baseline.json"
```

Two traps, both hit while producing this audit:

1. **A test import is not usage.** `calendar-month.test.tsx` imports
   `calendar-month.tsx`, so the module compiles and vitest reports it as covered.
   Exclude test files from the graph.
2. **A stray import hides dead code.** During the negative test a single
   `import './components/entry-row'` in `app.tsx` made `entry-row.tsx` look
   reachable. That edit got committed by accident (`5ebc44e`, reverted in
   `b03355b`) and temporarily invalidated the evidence. Re-run the script before
   trusting any reachability claim.

Server side: `grep -rn 'apiFetch(' apps/web/src` and check the caller is reachable.
For CalDAV/CardDAV there is no caller at all.

### Deletion cost

Deleting the obsolete set removes **9 of the 11 vitest files** (34 tests → ~5) and
the bulk of `internal/app`'s Go tests (`caldav_test.go`, `carddav_test.go`,
`calendar_io_test.go`, `occurrences_test.go`, `recurrence_test.go`).

**This is expected, not a regression.** Whoever deletes the code must update
`docs/baseline.json` in the same commit or CI will report a false drop.

## 4. Schema drift: three sources of truth, none of them authoritative

Collections are defined in **three** places that can disagree:

1. `internal/app/schema.go` — 12 core collections, `map[string]any` tables.
2. `internal/app/finance_schema.go` — 6 finance collections, typed `core.Field`.
3. `internal/app/asset_groups.go` — 2 asset collections + the `assets.asset_group`
   link field.

Plus `apps/server/pb_migrations/` (18 files) which mostly just *call* the
`Ensure*` functions, and the bootstrap in `app.go:19-44` which calls them
**again** on every boot.

Why this is dangerous:

- The `Ensure*` functions run on **every boot**, not only via migrations. A
  migration that changes a collection and a later edit to the `Ensure*` table
  can fight, and the `Ensure*` version wins because it runs last.
- They are **idempotent in a specific way**: find-then-add-missing-fields,
  never recreate. That is what keeps collection IDs stable. Replacing any of
  them with a create-or-drop implementation silently regenerates IDs and breaks
  `transaction_attachments.transaction` relation references.
- `finance_schema.go:140-144` and `asset_groups.go:67-71` **overwrite** the five
  CRUD rules unconditionally on every boot. They will silently revert a
  deliberate rule change made through the PocketBase admin UI or a migration.
- `schema.go`'s engine only understands `text`/`bool`/`date`/`json`. Finance
  needs `number`, `relation`, and `file`, which is why `finance_schema.go` and
  `asset_groups.go` each reimplement the loop. The repair engine is duplicated
  **five times** in this repo — `schema.go`, `finance_schema.go`,
  `asset_groups.go`, `notifications.go`, `transaction_attachments.go`,
  `caldav_changes.go`.
- `schema.go:68` — `EnsureCollections` ends with `EnsureFinanceCollections`. The
  "core" entry point silently depends on the finance schema. Removing either
  side has to account for the other.

Piggybudget's copies are also **older** than Taskboard's in places — `schema.go`
is missing the `dav_data` field, `config.go` is missing `BackupJSONEnabled` and
cron validation, `backup_command.go` is missing encryption. Divergence is
already happening; there is no mechanism to detect it beyond `diff`.

## 5. Other technical debt for later phases

**The finance UI has no tests.** `components/budgeting/budgeting-dashboard.tsx`
(~1900 LOC) and `data.ts` have zero coverage. Every one of the 34 vitest tests
targets Taskboard code. The migration can break the entire product surface and
the suite stays green.

**The OpenAPI spec is decorative.** Only the six finance *list* operations are
registered with Huma (`finance.go:50-64`); the other ~127 routes are
undocumented. So `pnpm generate:client` produces a 16-file client that is
imported by nothing, and CI's `git diff --exit-code` after regeneration only
proves those six stubs are unchanged. Real routes are hand-written in
`apiFetch` calls.

**TanStack Query is mounted and unused.** `QueryClientProvider` is in
`main.tsx`, but there is no `useQuery`/`useMutation` in the repo. All data
loading is hand-rolled `useEffect`. Either adopt it or drop the dependency.

**Two competing notification mechanisms.** The server has `/api/notifications*`
and a running reminder scheduler, but the live UI
(`finance-notifications.tsx`) stores read/dismissed state in **localStorage**
and never calls the API. The real API client
(`notifications-popover.tsx`) is unreachable. Decide which one is the product.

**Two competing attachment mechanisms.** `transaction_attachments` (protected
file field, proper upload route) coexists with `transactions.attachments`
(JSON) and `transactions.receipt` (text). Do not assume they hold the same data.

**Security items found, not fixed:**

- `app.go:164` logs the registration OTP to stdout: `code=%s`. In any
  deployment where stdout is captured, that is a credential leak. Worse, the
  registration OTP is generated by `activationCode()` using `value % 10` on
  random bytes — modulo bias, weak entropy (6 digits, biased).
- `POST /api/auth/guest` is unauthenticated and returns a full auth token for a
  shared account. It is gated on `PIGGYBUDGET_DEVELOPMENT` (`app.go:207`), which
  is correct, and `.env.example` ships `PIGGYBUDGET_DEVELOPMENT=true`. Any
  deployment that copies `.env.example` verbatim is exposed.
- `docs/*.md` (except these audit docs) are Taskboard's and actively
  misleading: `API.md`, `AUTH.md`, `DATA-MODEL.md`, `NAVIGATION.md`,
  `COMPONENTS.md`, `COLORS.md`, `DEPLOYMENT.md`, `DEVELOPMENT.md`,
  `README.md`, plus root `PATCH.md` and `ROADMAP.md`. `AGENTS.md` still says
  "Slopstack Agent Rules".

**Checkpoint immutability is a presence check.**
`checkpointConfirmationPresent` (`finance.go:81-84`) tests only that a `confirm`
query key *exists*. `?confirm=0` passes. Enforced in three places that must
agree: the route (207, 243), the record hook (67-78), and the helper.

**Ownership failures return 404, not 403** on custom routes
(`asset_groups.go:344-350`). Observable client behaviour — do not "fix" it
during extraction.

**`/api/finance/*` is registered twice**, under `/api/finance` and `/api`
(`finance.go:89`, `asset_groups.go:144`). The web app only uses the long form.
The alias has no in-repo caller but removing it is still an API break. Note the
attachment routes are `/api/finance`-only with no alias.

**Backup cron is never validated.** `PIGGYBUDGET_BACKUP_CRON` defaults to
`0 3 * * *` and goes straight into `settings.Backups.Cron`. An invalid
expression silently disables scheduled backups. Taskboard's `config.go` fixed
this with `cron.Validate`; Piggybudget has the older version.

**No backup encryption.** Piggybudget's `backup_command.go` is the reduced copy
— no `.zip.enc`, no JSON export, no pruning scheduler. Taskboard has all of it.
For an app holding bank data, pull Taskboard's version forward.

**Audit log collection exists but is never written.** `audit_logs` is created by
`schema.go:27` with all-NULL rules, and nothing in the codebase inserts a row.

**Five permission collections are dead.** `groups`, `permissions`,
`group_permissions`, `user_permissions`, `group_members` all exist with NULL
rules; `authorization.go` never reads them. Either implement the permission model
or delete the collections.

**shadcn `components/ui/*` is 60 files, 58 unreachable.** Only `tooltip.tsx` and
`popover.tsx` are actually imported. Vendored library, not inherited Taskboard app
code — prune on bundle-size grounds (the build already warns about >500 kB chunks),
not on the obsolescence grounds used in §3.

## 6. Rules that must not be broken

1. Never delete `pb_data`. It is the developer's data. Phase 0 read it
   read-only; no migration was run against it.
2. Never force-push, and do not add a git remote without the owner's decision.
3. Do not hand-edit `apps/web/src/api/generated` (`AGENTS.md`, and CI enforces
   it with `git diff --exit-code` after regeneration).
4. Never edit an applied migration; add a new one.
5. If you change a route, collection, field, rule, or the auth flow, update
   `docs/baseline.json` in the same commit. `scripts/baseline-check.mjs` exists
   to make that obligation visible.
