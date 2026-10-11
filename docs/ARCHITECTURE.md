# Piggybudget Architecture

Phase 0 baseline audit with Phase 1 identity updates. Historical measurements
remain recorded in `docs/baseline.json`; current identity and compatibility notes
are in `docs/IDENTITY-MIGRATION.md`.

## 1. Repository layout

```
piggybudget/
├── apps/
│   ├── server/                  Go server (PocketBase + cobra)
│   │   ├── cmd/piggybudget/     Piggybudget server entrypoint
│   │   ├── internal/app/        all HTTP routes, schema, auth, finance
│   │   ├── internal/calendar/   iCalendar recurrence expansion (Taskboard)
│   │   ├── internal/reminders/  reminder model, store, scheduler
│   │   └── pb_migrations/       19 PocketBase Go migration files
│   └── web/                     Vite + React 19 + TypeScript SPA
│       └── src/
│           ├── api/             pocketbase SDK client, apiFetch, generated OpenAPI client
│           ├── components/app/  Piggybudget-owned UI (auth, search, composer, notifications)
│           ├── components/budgeting/  Piggybudget dashboard + data loader
│           ├── components/ui/   shadcn/base-ui primitives
│           ├── components/tabs/ ** Taskboard tab UI — NOT reachable from the running app
│           ├── components/time-grid/  ** Taskboard — NOT reachable
│           ├── components/container-manager/  ** Taskboard — NOT reachable
│           └── data.ts, theme.ts  ** Taskboard — NOT reachable
├── openapi/openapi.json         exported Huma spec (finance list endpoints only)
├── pb_migrations -> apps/server/pb_migrations
├── pb_data/                     local PocketBase data dir (data.db, auxiliary.db)
├── docs/                        this audit + pre-existing Taskboard/Slopstack docs
└── .github/workflows/           ci.yml, release.yml
```

Pre-existing docs in `docs/` (`API.md`, `AUTH.md`, `DATA-MODEL.md`, `NAVIGATION.md`,
`COMPONENTS.md`, `COLORS.md`, `DEPLOYMENT.md`, `DEVELOPMENT.md`, `README.md`) were
inherited from the template/Taskboard and still describe Taskboard behaviour. They are
not authoritative for Piggybudget. See `docs/AGENT-NOTES.md`.

## 2. Lineage

```
Slopstack (template, module github.com/andreasmolnardev/slopstack)
   │
   └── Taskboard  (calendar/task app; same module path)
          │
          └── Piggybudget  (finance app; same module path)
```

Piggybudget did **not** fork from the template directly. It forked from Taskboard and
replaced the product surface. Evidence:

- `apps/server/internal/app/caldav.go:43` still returns
  `WWW-Authenticate: Basic realm="Taskboard CalDAV"`.
- `apps/web/src/theme.ts:1` uses storage key `taskboard-custom-theme`; lines 158/164
  dispatch the `taskboard-custom-theme-change` event.
- `apps/web/src/components/tabs/settings-tab.tsx:294` emits
  `"That is not a valid Taskboard theme."`
- `apps/server/internal/app/` is byte-identical to Taskboard for
  `auth.go`, `authorization.go`, `ownership.go`, `openapi.go`, `search.go`,
  `notifications.go`, `occurrences.go`, `calendar_io.go`, `caldav_changes.go`,
  and the whole `internal/calendar` and `internal/reminders` packages
  (`diff` reports no differences).

## 3. Module identity

Piggybudget now uses its own module and package identities:

| Artifact | Current value |
|---|---|
| Go module path | `github.com/piggybudget/piggybudget` |
| Server entrypoint | `apps/server/cmd/piggybudget` |
| Web package | `@piggybudget/web` |
| Root package | `piggybudget` |
| Preferred env prefix | `PIGGYBUDGET_*` (`SLOPSTACK_*` remains a deprecated alias) |
| Docker image/build target | `piggybudget` |
| Persistent data | unchanged `pb_data` / `/app/pb_data` and `slopstack-data` volume |

## 4. apps/server

Entry point `apps/server/cmd/piggybudget/main.go`:

1. `app.LoadConfig()` reads `PIGGYBUDGET_*` env vars and falls back to the
   corresponding `SLOPSTACK_*` key for compatibility.
2. `pocketbase.NewWithConfig` with `DefaultDataDir = config.StoragePath`
   (default `pb_data`), `DefaultDev = config.Development`.
3. Builds a Huma v2 API (`humago` adapter) with security scheme `pocketbaseAuth`
   (HTTP bearer / JWT).
4. `app.Register(pb, config, api)` registers the finance OpenAPI stubs, flags,
   bootstrap hooks, record hooks, and serve hooks.
5. Registers `openapi export` and the `backup` cobra command, then `pb.Start()`.

Bootstrap hook order (`internal/app/app.go:19-44`) — each of these runs on every boot
and repairs the schema in place:

```
RunAppMigrations()               # applies apps/server/pb_migrations
EnsureCollections()              # core schema + CalDAV changes + finance schema
EnsureAssetGroupCollections()
EnsureTransactionAttachmentCollection()
EnsureNotificationCollections()
EnsureCalDAVChanges()            # also called inside EnsureCollections
applyBackupConfig()
```

Record-level hooks registered in `Register`:

| Hook | Collections | File |
|---|---|---|
| `registerOwnershipHooks` | todos, events, lists, calendars, contacts | `ownership.go` |
| `registerFinanceHooks` | checkpoints (immutability) | `finance.go:66` |
| `RegisterAssetGroupHooks` | asset_groups, asset_positions, assets | `asset_groups.go:97` |
| `RegisterTransactionAttachmentHooks` | transaction_attachments | `transaction_attachments.go:65` |
| `registerCalDAVChangeHooks` | CalDAV journal | `caldav_changes.go` |
| `registerReminderScheduler` | reminders | `app.go:51` |
| user create hook | provisions default `lists`/`calendars`/`address_books` rows | `app.go:54-59` |

Note `app.go:52-53` carries an explicit comment: the container provisioning hook is
kept only "to keep protocol fixtures available to the server's existing DAV tests".
It is not part of the Piggybudget product surface.

## 5. Finance domain

`apps/server/internal/app/finance_schema.go` defines six owner-scoped collections:

| Collection | Fields | Indexes |
|---|---|---|
| `accounts` | owner(req), name(req), type, currency, opening_balance, opening_balance_date, notes, archived | `idx_accounts_owner` |
| `transactions` | owner(req), account(req), date(req), amount, type, payee, description, category, budget, tags(json), attachments(json), receipt, asset, receivable, notes, transfer_id, cleared, reconciled | `idx_transactions_owner_account_date`, `idx_transactions_owner_transfer` |
| `checkpoints` | owner(req), account(req), date(req), balance, note | `idx_checkpoints_owner_account_date` |
| `budgets` | owner(req), name(req), category, amount, start_date, end_date, notes, archived | `idx_budgets_owner_dates` |
| `assets` | owner(req), name(req), type, value, quantity, currency, purchase_date, purchase_price, purchase_transaction, target_sale_price, as_of, notes, status, archived | `idx_assets_owner` |
| `goals` | owner(req), name(req), target_amount, current_amount, target_date, account, notes, completed | `idx_goals_owner` |

All six get list/view/create/update/delete rule `@request.auth.id = owner`
(`finance_schema.go:9`, `140-144`).

`apps/server/internal/app/asset_groups.go` adds two more collections plus a link field:

| Collection | Fields | Indexes |
|---|---|---|
| `asset_groups` | owner(req), name(req), description, currency, notes, archived | `idx_asset_groups_owner` |
| `asset_positions` | owner(req), group(req), name(req), type, quantity, value, currency, purchase_date, purchase_price, target_sale_price, as_of, notes, status, archived | `idx_asset_positions_owner_group` |

and adds optional `asset_group` text field to `assets` (`asset_groups.go:86-88`).

`apps/server/internal/app/transaction_attachments.go` adds:

| Collection | Fields |
|---|---|
| `transaction_attachments` | owner(req), transaction(req, relation → transactions, maxSelect 1), file(req, file field, **protected**, maxSize 5 MiB, mimeTypes image/jpeg\|png\|gif\|webp) |

Upload caps: 25 MiB total request, 5 MiB per file, 5 files
(`transaction_attachments.go:22-25`).

Finance HTTP surface is registered twice, under `/api/finance/*` and `/api/*`
(`finance.go:89`, `asset_groups.go:144`), so both `/api/finance/accounts` and
`/api/accounts` work identically. `/api/finance/*` is the documented prefix.

## 6. apps/web

Router (`apps/web/src/router.tsx`) defines 8 routes, all children of one root route
whose component is `App`:

| Path | Rendered by |
|---|---|
| `/` | `App` → `BudgetingDashboard` view `dashboard` |
| `/transactions` | `App` → `BudgetingDashboard` view `transactions` |
| `/budgets` | `App` → `BudgetingDashboard` view `budgets` |
| `/assets` | `App` → `BudgetingDashboard` view `assets` |
| `/goals` | `App` → `BudgetingDashboard` view `goals` |
| `/settings` | `App` → `BudgetingDashboard` view `settings` |
| `/auth/login` | `App` renders `AuthScreen` (unauthenticated) |
| `/auth/register` | `App` renders `AuthScreen` mode=register |

There are no per-route components — `app.tsx:33-40` maps pathname to a
`SidebarTab` and the single `BudgetingDashboard` switches on that view. TanStack
Router is therefore used for path matching and navigation only.

TanStack Query is mounted (`main.tsx:1-3`, `QueryClientProvider`) but **no
`useQuery`/`useMutation` exists anywhere in the repo**. Data loading is done by
hand-rolled `useEffect` + `apiFetch` in `app.tsx:135-151` and
`components/budgeting/data.ts`. The provider is dead weight today.

Generated OpenAPI client exists at `apps/web/src/api/generated/` (16 files,
produced by `@hey-api/openapi-ts` from `openapi/openapi.json`) but is **imported by
nothing**. All data access goes through `apiFetch` (`apps/web/src/api/client.ts`)
and the PocketBase JS SDK (`apps/web/src/api/pocketbase.ts`).

Vite dev server proxies `/api` to `http://localhost:8090` (`vite.config.ts`).

Piggybudget-owned components actually in the running bundle:

- `components/app/auth-screen.tsx` — login/register/guest
- `components/app/finance-search.tsx` — client-side ⌘K palette over local `BudgetData`
- `components/app/finance-notifications.tsx` — localStorage-backed notification state
- `components/budgeting/budgeting-dashboard.tsx` + `data.ts` — all six views and all
  finance API calls
- `components/sidebar.tsx` — nav, theme toggle, sign-out
- `components/ui/*` — shadcn primitives (only `tooltip` is imported, by `main.tsx`)

## 7. Inherited Taskboard code that Piggybudget does NOT use

Method: a reachability walk from `apps/web/src/main.tsx` following every relative
`from '...'` import (resolving `.ts`/`.tsx`/`/index.ts`). A file is "reachable" only
if it is in the module graph of the production entrypoint. Test files were excluded
from the graph; an import inside a test does **not** make a module used.

Server side, the criterion is: is the file wired into `registerRoutes` or a
bootstrap/record hook in `app.go`, and does any Piggybudget web file call its route?

### 7.1 Server — OBSOLETE-IN-PIGGYBUDGET

| File | LOC | Evidence |
|---|---|---|
| `internal/app/caldav.go` | 854 | Registers `/.well-known/caldav`, `/caldav`, `/caldav/{path...}` (lines 49-51). Called only by `registerCalDAVRoutes` (app.go:195). Operates on `calendars`/`events` collections. No Piggybudget web file imports a calendar collection; `grep apiFetch` shows zero `/caldav` calls. |
| `internal/app/caldav_xml.go` | 139 | All 9 functions are unexported and referenced only from `caldav.go` / `caldav_test.go`. No `Router.*`, no exported symbol. |
| `internal/app/caldav_changes.go` | 152 | `EnsureCalDAVChanges` + `registerCalDAVChangeHooks`, both wired (app.go:40, 50). Maintains `caldav_changes` journal. Only consumer is CalDAV. |
| `internal/app/carddav.go` | 333 | Registers `/.well-known/carddav`, `/carddav`, `/carddav/{path...}` (lines 32-34). Operates on `address_books`/`contacts`. No Piggybudget web caller. |
| `internal/app/calendar_io.go` | 596 | Registers `POST /api/calendars/import`, `GET /api/calendars/{id}/export.ics` (lines 28-29). Only web caller is `components/tabs/settings-tab.tsx:324,527`, which is itself unreachable. |
| `internal/app/occurrences.go` | 480 | Registers `/api/calendar/occurrences*` (lines 53-55). Only web callers are `components/app/create-composer.tsx:238` and `components/entry-row.tsx:53`, both unreachable. |
| `internal/app/search.go` | 292 | `GET /api/search` searches only `todos`, `events`, `lists`, `calendars`, `contacts` (lines 65-69). Piggybudget's search (`components/app/finance-search.tsx`) is client-side over `BudgetData` and makes no request. Only web caller is unreachable `components/tabs/search-tab.tsx:51`. |
| `internal/calendar/recurrence.go` | ~200 | Imported by `caldav.go:20` and `occurrences.go:17`, both Taskboard-lineage. Nothing in a Piggybudget-reachable path uses it. |

Notably **absent** versus Taskboard: `vcard.go`, `carddav_changes.go`,
`backup_encryption.go`, `backup_formats.go`, `backup_scheduler.go`. Piggybudget's
`carddav.go` inlines `contactVCard`/`normalizeVCard`/`parseVCard` (lines 250-296)
where Taskboard extracted `vcard.go`.

Not in Piggybudget but present in the Taskboard line: `registerTodoRoutes`
(`taskboard/.../app.go:241`) which served `GET /api/todos`. That route **is**
absent from Piggybudget.

### 7.2 Server — still reachable, still inherited

These are Taskboard-lineage but are actually wired and tested:

| File | Why it is still live |
|---|---|
| `internal/reminders/*.go` | `registerReminderScheduler` (app.go:51) runs the scheduler; `POST /api/reminders` is live (notifications.go:125). Its only web caller is unreachable `create-composer.tsx:261`, so the collection is written by the scheduler but the HTTP write endpoint has no product caller. |
| `internal/app/notifications.go` | `GET /api/notifications*` live. Web `finance-notifications.tsx` uses localStorage instead — it does **not** call the API. `components/app/notifications-popover.tsx` is the real API client and is unreachable. |
| `internal/app/ownership.go` | Hooks on `todos`, `events`, `lists`, `calendars`, `contacts` — all Taskboard collections. Compiled and bound; guards collections Piggybudget's web never writes. |
| `internal/app/schema.go` | Creates all 12 core collections, only `users` is Piggybudget-relevant. |
| `internal/app/backup_command.go` | Registered in `main.go:33`. |

### 7.3 Web — unreachable production modules (not reachable from `main.tsx`)

Taskboard calendar/task UI. All 11 accompanying test files exist and pass, which
keeps the code "live" to the test runner but invisible to the product:

```
components/tabs/calendar-tab.tsx
components/tabs/lists-tab.tsx
components/tabs/people-tab.tsx
components/tabs/search-tab.tsx
components/tabs/settings-tab.tsx
components/tabs/upcoming-tab.tsx
components/time-grid/{index,layout,position,segments,dates,types,time-grid}.ts(x)
components/container-manager/{index,container-manager}.tsx
components/calendar-month.tsx
components/full-month-calendar.tsx
components/entry-row.tsx
components/create-fields.tsx
components/app/create-composer.tsx
components/app/create-composer.helpers.ts
components/app/notifications-popover.tsx
data.ts
theme.ts
hooks/use-mobile.ts
api/generated/**          (16 files)
```

Test files proving these modules still compile, and counting toward the
`34 tests` baseline:

```
components/tabs/lists-tab.test.tsx
components/time-grid/{layout,position,segments}.test.ts, time-grid.test.tsx
components/container-manager/container-manager.test.tsx
components/calendar-month.test.tsx
components/full-month-calendar.test.tsx
components/app/create-composer.helpers.test.ts
data.test.ts
theme.test.ts
```

Note `components/ui/*` (56 shadcn primitives) is also unreachable except
`tooltip`, but that is a vendored component library, not inherited Taskboard
application code — different remediation.

### 7.4 Consequence

The Taskboard surface is **not removed** from the server. `/caldav`, `/carddav`,
`/api/search`, `/api/calendars/*`, `/api/calendar/occurrences*` are all live HTTP
routes over Taskboard collections that Piggybudget's UI never calls. They are
attack surface and they still create collections and rows
(`provisionDefaultContainers` runs on every user create, app.go:54-59).

Deletion is out of scope for Phase 0. The inventory and evidence live in
`docs/EXTRACTION-INVENTORY.md`.
