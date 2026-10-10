# Piggybudget Compatibility Baseline

Everything a later migration phase must preserve. All values verified on the commit
recorded in `docs/baseline.json` (Phase 0, `docs/architecture` commit `0eb63ad`).

## 1. Tool versions

| Tool | Version | Source of truth |
|---|---|---|
| Go | `go1.27.1 darwin/arm64` | `go version` |
| Go module directive | `go 1.26.0` | `go.mod:3` |
| Node | `v22.23.2` | `node -v` |
| pnpm | `11.8.0` | `pnpm -v` |

`package.json:5` declares `"packageManager": "pnpm@11.8.0"`. CI currently pins
pnpm `11` / node `24` / go `stable` — see `.github/workflows/ci.yml`.

## 2. Baseline command results

| Command | Working dir | Result |
|---|---|---|
| `go build ./...` | `apps/server` | PASS |
| `go test -count=1 ./...` | `apps/server` | PASS — `internal/app` 27.1s, `internal/calendar` 2.5s, `internal/reminders` 2.2s; `cmd/slopstack` and `pb_migrations` have no test files |
| `pnpm -r lint` | repo root | PASS (`eslint src` in `apps/web`, no output) |
| `pnpm -r test` | repo root | PASS — vitest 4.1.10, 11 files, 34 tests, 1.76s |
| `npx tsc -b --noEmit` | `apps/web` | PASS (not part of `pnpm lint`; `pnpm build` runs `tsc -b && vite build`) |
| `go vet ./...` | `apps/server` | PASS (no output) |

The Go test packages are the only Go tests in the repo. The 34 vitest tests cover
Taskboard-era components, not the finance dashboard — see §7.

## 3. HTTP route surface

Registered from `internal/app/app.go:178-201` (`registerRoutes`). PocketBase's own
built-in `/api/collections/...`, `/api/auth-with-password`, `/api/settings`,
`/api/backups` routes are additionally present and not listed here.

### 3.1 Static / docs

| Method | Path | File |
|---|---|---|
| GET | `/openapi.json` | `app.go:179` |
| GET | `/openapi.yaml` | `app.go:180` |
| GET | `/docs` | `app.go:187` (ReDoc, CDN-loaded) |

### 3.2 Auth

| Method | Path | Auth | File |
|---|---|---|---|
| GET | `/api/auth/registration-policy` | none | `app.go:204` |
| POST | `/api/auth/guest` | none, **only when `SLOPSTACK_DEVELOPMENT=true`** | `app.go:210` |
| GET | `/api/auth/app-passwords` | bearer | `app_passwords.go:78` |
| POST | `/api/auth/app-passwords` | bearer | `app_passwords.go:85` |
| DELETE | `/api/auth/app-passwords/{id}` | bearer | `app_passwords.go:117` |

### 3.3 Finance — registered under BOTH prefixes

`finance.go:89` and `asset_groups.go:144` loop over `["/api/finance", "/api"]`,
so every row below exists twice. `/api/finance/*` is the documented form;
`/api/*` is the alias.

| Method | Path (×2 prefixes) | File |
|---|---|---|
| GET | `{prefix}/accounts` | `finance.go:98` |
| POST | `{prefix}/accounts` | `finance.go:101` |
| GET | `{prefix}/accounts/{id}` | `finance.go:104` |
| PATCH | `{prefix}/accounts/{id}` | `finance.go:107` |
| PUT | `{prefix}/accounts/{id}` | `finance.go:110` |
| DELETE | `{prefix}/accounts/{id}` | `finance.go:113` |
| GET | `{prefix}/accounts/{id}/summary` | `finance.go:118` |
| POST | `{prefix}/accounts/{id}/reconcile` | `finance.go:119` |
| …same 6 verbs… | `{prefix}/transactions` | `finance.go:98-115` |
| …same 6 verbs… | `{prefix}/checkpoints` | " |
| …same 6 verbs… | `{prefix}/budgets` | " |
| …same 6 verbs… | `{prefix}/assets` | " |
| …same 6 verbs… | `{prefix}/goals` | " |
| GET | `{prefix}/asset-groups`, `{prefix}/asset-groups/{id}` | `asset_groups.go:167,206` |
| POST | `{prefix}/asset-groups` | `asset_groups.go:182` |
| PATCH/PUT | `{prefix}/asset-groups/{id}` | `asset_groups.go:240,241` |
| DELETE | `{prefix}/asset-groups/{id}` | `asset_groups.go:242` |
| GET | `{prefix}/asset-positions`, `{prefix}/asset-positions/{id}` | `asset_groups.go:167,206` |
| POST | `{prefix}/asset-positions` | `asset_groups.go:182` |
| PATCH/PUT | `{prefix}/asset-positions/{id}` | `asset_groups.go:240,241` |
| DELETE | `{prefix}/asset-positions/{id}` | `asset_groups.go:242` |
| PATCH | `{prefix}/assets/{id}/group` | `asset_groups.go:147` |
| PUT | `{prefix}/assets/{id}/group` | `asset_groups.go:148` |

Attachments are **only** under `/api/finance` (no `/api` alias):

| Method | Path | File |
|---|---|---|
| GET | `/api/finance/transactions/{transactionId}/attachments` | `transaction_attachments.go:101` |
| POST | `/api/finance/transactions/{transactionId}/attachments` | `transaction_attachments.go:102` |
| DELETE | `/api/finance/transactions/{transactionId}/attachments/{id}` | `transaction_attachments.go:103` |

### 3.4 Taskboard-lineage routes — STILL REGISTERED

| Method | Path | File | Product caller |
|---|---|---|---|
| ANY | `/.well-known/caldav`, `/caldav`, `/caldav/{path...}` | `caldav.go:49-51` | none |
| ANY | `/.well-known/carddav`, `/carddav`, `/carddav/{path...}` | `carddav.go:32-34` | none |
| POST | `/api/calendars/import` | `calendar_io.go:28` | unreachable `settings-tab.tsx:324` |
| GET | `/api/calendars/{id}/export.ics` | `calendar_io.go:29` | unreachable `settings-tab.tsx:527` |
| GET | `/api/calendar/occurrences` | `occurrences.go:53` | none |
| POST | `/api/calendar/occurrences/{masterId}/override` | `occurrences.go:54` | unreachable `create-composer.tsx:238` |
| POST | `/api/calendar/occurrences/{masterId}/cancel` | `occurrences.go:55` | unreachable `entry-row.tsx:53` |
| GET | `/api/search` | `search.go:76` | unreachable `search-tab.tsx:51` |
| GET | `/api/notifications` | `notifications.go:120` | unreachable `notifications-popover.tsx:31` |
| PATCH | `/api/notifications/{id}/read` | `notifications.go:121` | " |
| POST | `/api/notifications/{id}/snooze` | `notifications.go:122` | " |
| POST | `/api/notifications/{id}/dismiss` | `notifications.go:123` | " |
| POST | `/api/notifications/read-all` | `notifications.go:124` | " |
| POST | `/api/reminders` | `notifications.go:125` | unreachable `create-composer.tsx:261` |

**Correction to a common assumption:** CalDAV and CardDAV routes were **not
removed** relative to Taskboard. Verified by reading `registerRoutes` in both
repos — Taskboard's `app.go:196-197` and Piggybudget's `app.go:195-196` call
`registerCalDAVRoutes(e)` and `registerCardDAVRoutes(e)` identically. What Piggybudget
removed is `registerTodoRoutes` (`GET /api/todos`, Taskboard `app.go:241-250`),
which returns an empty array.

Piggybudget's CalDAV/CardDAV implementations are **older and less capable** than
Taskboard's, not newer:

- `carddav.go`: 333 LOC vs Taskboard 876 LOC + a separate `vcard.go`.
  Piggybudget has no PROPFIND depth handling, no REPORT/`addressbook-multiget`,
  no SYNC-collection, no addressbook-query filters, and inlines
  `contactVCard`/`normalizeVCard`/`parseVCard` (lines 250-296).
- `caldav.go`: 854 LOC vs Taskboard 977 LOC. Piggybudget lacks
  `preservedCalDAVData`, `calDAVComponentMatches`, `calDAVTextMatches` (iCalendar
  filter parsing), and the known-property round-trip preservation.
- Piggybudget also lacks `carddav_changes.go`, `backup_encryption.go`,
  `backup_formats.go`, `backup_scheduler.go`, and `Config.BackupJSONEnabled`.

So: if Piggybudget ever wants working CalDAV/CardDAV, it must **pull forward from
Taskboard**, not extract its own versions upstream.

## 4. Collection inventory

Collection IDs are generated by PocketBase at creation time (`pbc_*`). The values
below were read from the live `pb_data/data.db` (read-only) and are **not**
reproducible from source — a fresh `EnsureCollections` run generates different IDs.
Treat them as environment state, not code constants.

### 4.1 Core schema — `internal/app/schema.go` (Taskboard lineage)

| Collection | ID in local pb_data | Type | Rules (L/V/C/U/D) |
|---|---|---|---|
| `users` | `_pb_users_auth_` | auth | list/view `id = @request.auth.id`; create `""`; update `id = @request.auth.id`; delete `""` |
| `app_passwords` | `pbc_2899921234` | base | all NULL (no API access; served only by custom routes) |
| `groups` | `pbc_3346940990` | base | all NULL |
| `permissions` | `pbc_3709660955` | base | all NULL |
| `group_permissions` | `pbc_2509884351` | base | all NULL |
| `user_permissions` | `pbc_2593766271` | base | all NULL |
| `group_members` | `pbc_714390402` | base | all NULL |
| `todos` | `pbc_113564862` | base | `@request.auth.id = owner` (all 5) |
| `events` | `pbc_1687431684` | base | `@request.auth.id = owner` |
| `lists` | `pbc_3277857102` | base | `@request.auth.id = owner` |
| `calendars` | `pbc_3774112919` | base | `@request.auth.id = owner` |
| `address_books` | `pbc_2492096707` | base | `@request.auth.id = owner` |
| `contacts` | `pbc_1930317162` | base | `@request.auth.id = owner` |
| `audit_logs` | `pbc_681515208` | base | all NULL (no code reads or writes it) |

`users` extra fields (`schema.go:14`): `display_name`, `disabled`, `isAdmin`,
`activation_code`, `registration_status`.

### 4.2 Finance schema — `internal/app/finance_schema.go`

All six get list/view/create/update/delete = `@request.auth.id = owner`.

| Collection | ID | Fields (required marked *) | Indexes |
|---|---|---|---|
| `accounts` | `pbc_2324088501` | owner*, name*, type, currency, opening_balance, opening_balance_date, notes, archived | `idx_accounts_owner` |
| `transactions` | `pbc_3174063690` | owner*, account*, date*, amount, type, payee, description, category, budget, tags(json), attachments(json), receipt, asset, receivable, notes, transfer_id, cleared, reconciled | `idx_transactions_owner_account_date`, `idx_transactions_owner_transfer` |
| `checkpoints` | `pbc_3341382147` | owner*, account*, date*, balance, note | `idx_checkpoints_owner_account_date` |
| `budgets` | `pbc_1308224162` | owner*, name*, category, amount, start_date, end_date, notes, archived | `idx_budgets_owner_dates` |
| `assets` | `pbc_1321337024` | owner*, name*, type, value, quantity, currency, purchase_date, purchase_price, purchase_transaction, target_sale_price, as_of, notes, status, archived, **asset_group** (added by `asset_groups.go:86-88`) | `idx_assets_owner` |
| `goals` | `pbc_207790276` | owner*, name*, target_amount, current_amount, target_date, account, notes, completed | `idx_goals_owner` |

### 4.3 Asset groups — `internal/app/asset_groups.go`

| Collection | ID | Fields | Indexes |
|---|---|---|---|
| `asset_groups` | `pbc_1339617899` | owner*, name*, description, currency, notes, archived | `idx_asset_groups_owner` |
| `asset_positions` | `pbc_1441390804` | owner*, group*, name*, type, quantity, value, currency, purchase_date, purchase_price, target_sale_price, as_of, notes, status, archived | `idx_asset_positions_owner_group` |

### 4.4 Attachments — `internal/app/transaction_attachments.go`

| Collection | ID | Fields |
|---|---|---|
| `transaction_attachments` | `pbc_2852624539` | owner*, transaction* (relation→transactions, maxSelect 1), file* (file field, protected, 5 MiB, image/jpeg\|png\|gif\|webp) |

Index: `idx_transaction_attachments_owner_transaction` on `(owner, transaction)`.

### 4.5 Notifications/reminders — `internal/app/notifications.go`

| Collection | ID | Fields |
|---|---|---|
| `notifications` | `pbc_2301922722` | owner*, title*, body, target_kind, target_id, reminder_key*, read, read_at, snoozed_until, dismissed_at |
| `reminders` | `pbc_163143500` | owner*, key*, target_kind*, target_id*, at*, offset, due_at*, channel*, status*, attempts, next_attempt_at, last_error, delivered_at |

Indexes: `idx_notifications_reminder_key` (unique), `idx_notifications_owner_read`,
`idx_reminders_key` (unique), `idx_reminders_due`, `idx_reminders_owner`.

### 4.6 CalDAV journal — `internal/app/caldav_changes.go`

| Collection | ID | Fields |
|---|---|---|
| `caldav_changes` | `pbc_2483696242` | owner*, calendar*, href*, resource_kind*, resource_id, etag, sequence*(int), deleted, changed_at* |

Indexes: `idx_caldav_changes_owner_sequence`, `idx_caldav_changes_owner_href`.

Total non-system collections: **26** (12 core + 6 finance + 2 asset + 1 attachment
+ 2 notification + 1 caldav journal), plus 6 PocketBase system collections.

Local `pb_data` is empty of user data — 0 rows in `users`, `transactions`,
`accounts`, `assets`, `todos`, `events`, `lists`, `calendars`, `contacts`.

## 5. Finance-specific auth and ownership rules

### 5.1 Read/write scoping

Two independent layers:

1. **PocketBase API rules** — all five CRUD rules on every finance collection are
   `@request.auth.id = owner`, so direct `/api/collections/<name>/records` access
   is owner-scoped.
2. **Custom route handlers** — every finance handler starts with
   `CurrentUser(event)` (`auth.go:19`) which 401s when `event.Auth == nil`, then
   loads records through `ownedFinanceRecord` / `ownedAssetGroupRecord`, which
   compare `record.GetString("owner") != owner` and return **404**, not 403.
   `ownedAssetGroupRecord` (`asset_groups.go:344-350`) rewrites the error name to
   e.g. `"asset group not found"`.

Ownership cannot be spoofed via the custom routes: `owner` is always set from
`event.Auth.Id` on create and update (`finance.go:186`, `finance.go:222`;
`asset_groups.go:199`, `asset_groups.go:234`).

### 5.2 Referential integrity

`validateFinanceLinks` rejects cross-user and dangling links before write. Checks
include: transaction `account` must be an owned `accounts` record; `checkpoints.account`
same; `goals.account`; `assets.purchase_transaction`; `budgets` on transactions;
`asset_positions.group` must be an owned `asset_groups` record
(`asset_groups.go:320-333`); `assets.asset_group` same (`asset_groups.go:336-342`).

### 5.3 Checkpoint immutability

`checkpoints` records cannot be updated or deleted without a `confirm` query
parameter. Enforced in three places, and all three must agree:

- route: `finance.go:207` (update), `finance.go:243` (delete)
- record hook: `finance.go:67-78`
- gate helper: `finance.go:81-84` — checks `_, present := request.URL.Query()["confirm"]`,
  i.e. **presence** of the key, not its value. `?confirm=0` passes.

Superusers bypass (`event.HasSuperuserAuth()`).

### 5.4 Reconciliation

`POST {prefix}/accounts/{id}/reconcile` (`finance.go:251-…`) walks checkpoint
windows, and for the first window with a non-zero unexplained amount creates one
transaction with `type=miscellaneous_reconciliation`, `category=Miscellaneous`,
`payee=Miscellaneous reconciliation`, `reconciled=true`, `cleared=true`, amount =
the unexplained delta, date copied from the checkpoint. If no gap exists it returns
400 `"no unexplained checkpoint gap to reconcile"`. It writes at most one record
per call.

### 5.5 Admin flag protection

`protectUserAdminFlag` (`app.go:150-176`): non-superuser creates force
`isAdmin=false` and `disabled=true`; registration mode then sets
`registration_status` to `awaiting_activation` (OTP mode, also logging the code to
stdout at `app.go:164` — **do not** treat that log as safe in production) or
`awaiting_approval`. Non-superuser updates restore `isAdmin` from the original
record, so it cannot be escalated.

### 5.6 Guest auth

`POST /api/auth/guest` is registered only when `config.Development` is true
(`app.go:207`). It provisions or reactivates a **single shared** account with
hardcoded email `guest@taskboard.local` (`guest_auth.go:9`) — a leftover Taskboard
identity — and returns a full auth token. The web app calls this from
`auth-screen.tsx:28,91` in development. It is unauthenticated by design and must
stay behind the development flag.

### 5.7 App passwords

`app_passwords.go` supports a second credential type for DAV clients: 24 random
bytes, base64url (`newAppPassword`, line 144), bcrypt-hashed at
`bcrypt.DefaultCost`, stored in `secret_hash` (hidden field). Auth throttling is
per username, per user ID, and per client IP (`app_password_throttle.go`), with an
escalating block duration. Piggybudget's UI has no product caller for these routes
(the only caller is unreachable `settings-tab.tsx`), but CalDAV/CardDAV use them.

## 6. Backup subsystem

### 6.1 Scheduled / configured backups

`applyBackupConfig` (`app.go:67-93`) runs on every bootstrap and writes into
PocketBase's own settings:

- `SLOPSTACK_BACKUP_ENABLED=false` (default) → clears `settings.Backups.Cron` and
  disables S3 entirely.
- otherwise `Backups.Cron = SLOPSTACK_BACKUP_CRON` (default `0 3 * * *`),
  `CronMaxKeep = SLOPSTACK_BACKUP_MAX_KEEP` (default `14`), and the S3 block
  (`SLOPSTACK_BACKUP_S3_*`).
- `SLOPSTACK_PUBLIC_URL` sets `settings.Meta.AppURL` (trailing slash trimmed).

Piggybudget has **no** `backup_scheduler.go`; scheduling is entirely PocketBase's
built-in cron.

### 6.2 CLI

`NewBackupCommand` (`backup_command.go:34`) is registered in `main.go:33`, giving
`piggybudget backup create|list|restore`.

- `create` → `pb.CreateBackup` with name `manual_<UTC 20060102_150405_000000000>.zip`.
- `list` → enumerates the backups filesystem, newest first, tab-separated
  `NAME  SIZE  MODIFIED` (RFC3339).
- `restore <exact-name>` → **requires `--confirm`**. Name is validated against
  `^@?[a-z0-9_-]+\.zip$` and length ≤ 150 (`backup_command.go:18,137`).
  Uses the `SLOPSTACK_BACKUP_RESTARTED=1` env guard (line 20) to prevent a restore
  loop.

Taskboard's version additionally accepts `.zip.enc` and exposes JSON export;
Piggybudget's does not. `scripts/backup-restore-smoke-test.sh` exercises the CLI.

## 7. Test coverage gap

All 11 vitest files / 34 tests target Taskboard-era modules
(`calendar-month`, `full-month-calendar`, `time-grid/*`, `container-manager`,
`lists-tab`, `create-composer.helpers`, `data`, `theme`).

`components/budgeting/budgeting-dashboard.tsx` (~1900 lines) and
`components/budgeting/data.ts` have **zero** frontend tests. There is no test for
`BudgetingDashboard` rendering, for `loadBudgetData`, or for any finance API call.

On the Go side `internal/app` tests (27s, the bulk of the suite) cover
`caldav_test.go` (248 LOC), `carddav_test.go`, `calendar_io_test.go` (391 LOC),
`occurrences_test.go` (245 LOC), `http_integration_test.go` (509 LOC) — i.e. mostly
the Taskboard surface. `finance_test.go` is 305 LOC.

**Risk:** deleting "unused" Taskboard code will remove most of the current test
suite. A CI job diffing `docs/baseline.json` test counts will show a large drop
that is expected, not a regression — the doc must record which counts are
meaningful (`apps/web` finance coverage is already zero).

## 8. Compatibility rule set for the migration

These are hard constraints. Breaking any one is a data-loss or API-break event.

### R1 — Collection names and IDs
- All 26 collection **names** above are frozen. Renaming requires a data migration
  and a coordinated web client change.
- Collection **IDs** must be preserved for existing databases. The `Ensure*`
  functions only add missing fields (`addMissingFields`, `finance_schema.go:135-139`,
  `asset_groups.go:62-66`) — they never recreate a found collection, so IDs are
  stable across boots. Any upstream extraction **must keep that idempotent
  find-then-patch behaviour**; replacing it with create-or-drop silently
  regenerates IDs and breaks `transaction_attachments.transaction` relation
  references.
- The finance/asset rule strings must remain exactly
  `@request.auth.id = owner`. `finance_schema.go:140-144` and
  `asset_groups.go:67-71` *overwrite* rules on every boot — an upstream
  implementation that only sets rules when creating would leave drifted rules on
  existing databases.

### R2 — Stored transaction data
- Field names, types, and required flags in §4.2 are the on-disk contract for
  `transactions`. Money is stored as PocketBase `NumberField` (float64).
- `transaction_attachments` files are **protected** PocketBase file fields; the
  custom routes do not serve raw bytes — clients fetch them through the
  authenticated file endpoint. Any change to `Protected` would expose receipts
  to unauthenticated callers, since filenames come from user input
  (`filepath.Base`, `transaction_attachments.go:186`).

### R3 — User credentials and auth
- `users` collection id `_pb_users_auth_`, auth-token format, and PocketBase's
  password hashing are owned by PocketBase, not by this repo. Extraction must not
  change how tokens are minted or how `users` records are stored, or every session
  and stored credential breaks.
- `app_passwords.secret_hash` is bcrypt at `DefaultCost`. Existing hashes stay
  valid only while the bcrypt cost constant is unchanged. Raising the cost is fine
  (bcrypt encodes it); changing the algorithm is not.
- The `isAdmin` protection in `protectUserAdminFlag` must survive extraction — it
  is a privilege-escalation guard, not product decoration.
- `POST /api/auth/guest` must remain gated on `Development` and must not become
  reachable in a production build.

### R4 — `pb_data` location
- `SLOPSTACK_STORAGE_PATH`, default `pb_data`, passed to
  `pocketbase.Config.DefaultDataDir` (`main.go:21`). Docker mounts a volume here
  (`docker-compose.yml`, `docker-compose.dev.yaml`). Relative default means CWD
  matters. Renaming the env var is a deployment break — treat it as a compat alias.
- Local `pb_data/` currently holds `data.db`, `auxiliary.db`, `.notify/`. Do not
  delete.

### R5 — `/api/*` shapes
- Error responses are PocketBase error envelopes
  (`{"code":…, "message":…, "data":{…}}`) produced by
  `event.UnauthorizedError` / `ForbiddenError` / `BadRequestError` /
  `NotFoundError`. Clients depend on the shape, not just the status.
- Ownership failures on custom routes return **404**, never 403. Changing to 403
  changes observable behaviour for client error handling.
- The dual `/api/finance/*` + `/api/*` registration must be preserved or the alias
  dropped **deliberately with a client update**; the web client currently uses
  `/api/finance/*` only (`budgeting-dashboard.tsx`, `data.ts`), so the `/api/*`
  alias has no in-repo caller.
- `/openapi.json` only documents the six finance **list** operations
  (`registerFinanceAPI`, `finance.go:50-64`); every other route is undocumented.
  `pnpm generate:client` therefore produces a client that covers almost nothing,
  which is why it is imported nowhere.

### R6 — Attachment upload/download behaviour
- Upload: `multipart/form-data` POST, max 5 files, 5 MiB each, 25 MiB total
  request, MIME sniffed with `http.DetectContentType` against
  `image/jpeg|png|gif|webp` — note sniffing on bytes, not the declared
  content type.
- Upload is **all-or-nothing**: records already created in the same request are
  deleted if a later file fails (`deleteTransactionAttachmentRecords`,
  `transaction_attachments.go:161,230-232`). Preserve this.
- List response items are `{id, transaction, file, collectionId, collectionName}`
  (`transactionAttachmentResponse`, line 234).
- Delete requires both `owner` and `transaction` to match, else 404.
- `transactions.attachments` (JSON field) and `transactions.receipt` (text field)
  are separate legacy mechanisms that coexist with the
  `transaction_attachments` collection. Do not assume they are the same data.

### R7 — `/api/finance/*` semantics
- `account` query filter is honoured only for `transactions`, `checkpoints`, and
  `goals` (`finance.go:129-135`); passing `?account=` to `accounts` or `budgets`
  is silently ignored.
- Sort order is per-collection (`financeSort`, `finance.go:422-433`):
  `accounts`/`budgets`/`goals` → `name`; `transactions`/`checkpoints` → `-date`;
  `assets` → `-as_of`. List responses are `financeRecordResponse` projections
  (`finance.go:435`), which start from `PublicExport()` and enrich `accounts` with
  a computed summary — **not** raw `PublicExport()`. The asset-group routes *do*
  return raw `PublicExport()` (`asset_groups.go:178,204,238`). Both shapes are
  live; the difference is observable.
- `PUT` and `PATCH` are aliased to the same handler for every resource, including
  `assets/{id}/group` and asset groups/positions. Removing `PUT` breaks clients.
- `POST /accounts/{id}/reconcile` creates at most one transaction per call and
  400s when there is nothing to reconcile. It is not idempotent-safe to retry
  blindly — a retry after success finds no gap and 400s.

### R8 — Taskboard-lineage routes
- `/caldav`, `/carddav`, `/api/search`, `/api/calendars/*`,
  `/api/calendar/occurrences*`, `/api/notifications*`, `/api/reminders` are live
  HTTP surface today. If a later phase removes them, that is a **breaking API
  change** and must be called out even though the Piggybudget web app has no
  caller. Removing the code also drops the Go test files listed in §7.
- The bootstrap still creates `lists`, `calendars`, and `address_books` rows for
  every new user (`app.go:54-59, 95-136`), and `EnsureCollections` still creates
  the `todos`/`events`/`contacts`/`caldav_changes` collections. Dropping the DAV
  code requires dropping those too, or the schema keeps growing collections
  nothing reads.