# Piggybudget Extraction Inventory

Phase 0 classification of every production Go file in
`apps/server/internal/app`, `internal/calendar`, and `internal/reminders`, plus the
matching Piggybudget web components.

Taskboard equivalents were read read-only to judge maturity. `diff` results below
are reproducible with `diff -u taskboard/apps/server/internal/app/<f>
piggybudget/apps/server/internal/app/<f>`.

## Categories

| Category | Meaning |
|---|---|
| **CORE** | Generic, app-agnostic. Extract upstream into versioned Slopstack Go packages. |
| **OPTIONAL-SHARED** | Generic but not universally wanted. Extract behind a build tag / opt-in. |
| **APP-OWNED** | Piggybudget-specific. Stays in this repo. |
| **OBSOLETE-IN-PIGGYBUDGET** | Inherited Taskboard calendar/DAV code with no product consumer. Do not extract; delete in a later phase. |

Line counts are from the files as of the Phase 0 baseline commit.

## 1. CORE — extract upstream

### 1.1 `internal/app/config.go` (102 LOC)

Generic env-var config loading: `RegistrationMode` enum, `Config`, `BackupS3Config`,
`LoadConfig()`, and the `env`/`envBool`/`envInt` helpers.

Piggybudget version is a **strict subset** of Taskboard's (117 LOC). Taskboard adds
`BackupJSONEnabled`, imports `pocketbase/tools/cron`, and formats the default cron
expression with `cron.Validate`/`cron.Aliases`. Piggybudget's `SLOPSTACK_BACKUP_CRON`
default `0 3 * * *` is never validated — an invalid cron silently disables backups.

Extract the Taskboard version (superset) with a **renamed env prefix** and a
deprecated-alias shim so `SLOPSTACK_*` keeps working (see R4 in
`docs/COMPATIBILITY.md`).

Blocker: the package name is `app` and the file has no app-specific imports, so it
is mechanically extractable. The env prefix rename is the only coupling.

### 1.2 `internal/app/auth.go` (24 LOC)

Byte-identical to Taskboard (`diff` = 0 lines).

- `RegistrationAllowed`, `RegistrationRequiresApproval`, `RegistrationRequiresOTP`
- `CurrentUser(event) (*core.Record, error)` — the single "who is calling" helper,
  returns 401 when `event.Auth == nil`.

This is the most reused helper in the codebase: every custom route in `finance.go`,
`asset_groups.go`, `search.go`, `notifications.go`, `occurrences.go`,
`calendar_io.go`, `transaction_attachments.go` calls it. Extract first; it is the
lowest-risk, highest-leverage file.

### 1.3 `internal/app/authorization.go` (15 LOC)

Byte-identical to Taskboard. `Authorize(event, permission)` — requires auth,
allows superuser, otherwise 403 `"missing permission: <permission>"`.

**Caveat for the migration:** this is a stub. `groups`, `permissions`,
`group_permissions`, `user_permissions`, and `group_members` collections exist with
NULL rules, but **nothing** resolves them — `Authorize` has no group lookup at all.
Its doc comment says "group and system-role resolution can be added without changing
route callers", which means the intended design was never finished. Extracting it
upstream would export a permission model that does not work.

Two options: extract as-is with the stub documented, or delete it and the five
permission collections. The audit cannot resolve this; a product decision is needed.

### 1.4 `internal/app/ownership.go` (179 LOC)

Byte-identical to Taskboard. Register hooks that:

- force `owner = event.Auth.Id` on create/update, reject updates/deletes where
  `Original().owner != Auth.Id`
- cascade-delete recurrence overrides when a master `events` record is deleted
- block deletion of non-empty containers (`lists`, `calendars`) with
  `"non-empty containers must be archived"`
- validate `address_book` ownership for `contacts`

**Piggybudget relevance: partial.** The generic mechanism — owner-forcing hooks plus
owner-scoped relation validation — is directly reusable by finance (it is the same
pattern that `asset_groups.go:97-127` and `transaction_attachments.go:65-95`
hand-roll today). But the *specific* hooks cover `todos`, `events`, `lists`,
`calendars`, `contacts` only. No finance collection is touched.

Extract upstream as a generic `RegisterOwnerHooks(pb, []CollectionSpec)` primitive
where the container-cascade and recurrence-cascade logic is an optional per-collection
callback. Do not extract the Piggybudget file verbatim — it is 100% Taskboard
collection names.

### 1.5 `internal/app/schema.go` (99 LOC)

Contains two separable things:

**(a) Generic collection-repair engine — CORE.**
`addMissingFields` (find-then-patch, never recreate) and `addFields` (the
`map[string]any` → typed `core.Field` decoder supporting `text`/`bool`/`date`/`json`
with `required`/`hidden` flags). This idempotent repair primitive is the exact
pattern duplicated in `finance_schema.go:130-153`, `asset_groups.go:57-91`,
`notifications.go:95-…`, `caldav_changes.go:17-45`, and
`transaction_attachments.go:29-66`. Five copies. Extract this; it is the highest-value
dedup in the repo.

The engine is lossy: it only adds missing fields, never removes or retypes, and
only knows 4 field types (no `number`, `relation`, `file`, `select`). Finance
escapes it by using `[]core.Field` directly. An upstream version should accept both.

**(b) The 12-collection Taskboard definition table — OBSOLETE-IN-PIGGYBUDGET.**
`users`, `app_passwords`, `groups`, `permissions`, `group_permissions`,
`user_permissions`, `group_members`, `todos`, `events`, `lists`, `calendars`,
`address_books`, `contacts`, `audit_logs`. Only `users` and `app_passwords` are
Piggybudget-relevant. Piggybudget's copy is **older** than Taskboard's: Taskboard's
`todos`/`events` carry an extra `dav_data` field (see the diff), which confirms the
snapshot drifted backwards.

Note `EnsureCollections` ends by calling `EnsureCalDAVChanges` then
`EnsureFinanceCollections` (`schema.go:65-68`) — the core entry point silently pulls
in both a CalDAV collection and the finance schema. Extract those calls out.

### 1.6 `internal/app/openapi.go` (15 LOC)

Byte-identical to Taskboard. `OpenAPIExportCommand` — a cobra `openapi export`
subcommand holding a single `Run func() error`. Trivial, but it is the hook every
derived app needs and it has no app-specific code.

Needs a signature change on extraction: today it takes no context and the caller in
`main.go` does the file writing. Accepting `ctx` and an output path makes it reusable
across repos.

### 1.7 `internal/app/backup_command.go` (155 LOC)

Byte-identical to Taskboard? No — Piggybudget is **155 LOC vs Taskboard 230 LOC**.
Piggybudget is the older, reduced copy:

| Capability | Piggybudget | Taskboard |
|---|---|---|
| `backup create` | yes | yes |
| `backup list` | yes | yes |
| `backup restore --confirm` | yes | yes |
| Name pattern | `^@?[a-z0-9_-]+\.zip$` | `^@?[a-z0-9_-]+\.zip(\.enc)?$` |
| Encrypted archives | no | yes (`backup_encryption.go`, `backup_formats.go`) |
| JSON export | no | yes (`createJSON`, `Config.BackupJSONEnabled`) |
| Restore auto-restart | env guard only | env guard + `dataDir` field |
| Pruning scheduler | no | yes (`backup_scheduler.go:pruneEncryptedBackups`) |

Extract the **Taskboard** version upstream. Piggybudget then adopts it and gains
encryption, which is a genuine security improvement for a finance app holding bank
data — and note that the Piggybudget version has **no** validation of
`SLOPSTACK_BACKUP_CRON` while Taskboard does.

`BackupFile{Name, Size, Modified}` and the three cobra subcommands are the stable
API surface; the encryption pieces are additive.

### 1.8 `internal/app/app.go` (231 LOC) — split

Not extractable as one file. Decompose:

| Part | Category | Note |
|---|---|---|
| `Register(pb, config, api)` bootstrap wiring | CORE-ish | the hook/flag registration pattern is generic |
| `applyBackupConfig` (`app.go:67-93`) | CORE | pure settings mapping; see §1.1 note that cron is unvalidated here |
| `provisionDefaultContainers` (`app.go:95-136`) | **APP-OWNED / obsolete** | creates `lists`/`calendars`/`address_books` rows for every new user. The binding at `app.go:52-59` says outright it is kept only to satisfy DAV tests. |
| `activationCode` (`app.go:138-148`) | CORE | generic 6-digit OTP generator; note the modulo-10 bias (`value%10` on a uniform byte) |
| `protectUserAdminFlag` (`app.go:150-176`) | CORE | privilege-escalation guard; must not be lost |
| `registerRoutes` (`app.go:178-201`) | APP-OWNED | the route list is per-app |
| `registerAuthRoutes` (`app.go:203-231`) | CORE | `/api/auth/registration-policy` is generic; guest route is app-specific and dev-gated |
| Huma API construction | CORE, but lives in `cmd/slopstack/main.go` | `newOpenAPI` sets title `"Piggybudget API"` — parameterized already, except the hardcoded title string |

The Huma/PocketBase bootstrap (build `pocketbase.NewWithConfig`, configure
`RootCmd`, wire Huma, register commands) is the strongest CORE candidate and has no
home in the Go module today — it is `package main` in `cmd/slopstack`.

## 2. OPTIONAL-SHARED — candidate for extraction behind an opt-in

### 2.1 `internal/app/app_passwords.go` (150 LOC)

Byte-identical to Taskboard. bcrypt app-password auth with per-username/per-user/per-IP
throttling. Currently only consumed by CalDAV/CardDAV (`AuthenticateAppPassword`).

It is genuinely generic — a "second credential for DAV/CLI clients" pattern with no
app-specific collections except the hardcoded `app_passwords` name. But its HTTP
routes have **no Piggybudget product caller** (the only one is the unreachable
`settings-tab.tsx`).

Extract as an optional package with a configurable collection name. Piggybudget can
either adopt it (if it keeps DAV) or drop it with the DAV code. Note the routes are
already registered regardless (`app.go:191`).

### 2.2 `internal/app/app_password_throttle.go` (130 LOC)

Byte-identical to Taskboard. Generic escalating-block rate limiter
(`appPasswordThrottleKey`, `allowed`, `recordFailure`, `appPasswordBlockDuration`,
`reset`, `removeOldest`). Completely app-agnostic — a good standalone package, but
only useful alongside §2.1.

### 2.3 `internal/app/guest_auth.go` (49 LOC)

Byte-identical to Taskboard **except** the hardcoded email
`guest@taskboard.local` (`guest_auth.go:9`) — a leaked Taskboard identity in a
finance app.

Extract as an optional dev-only helper, with the guest email made configurable.
This is a small, low-risk, high-clarity extraction.

### 2.4 `internal/app/notifications.go` (506 LOC)

Byte-identical to Taskboard (`diff` = 0). `notifications` + `reminders`
collections, five `/api/notifications*` routes, `POST /api/reminders`, and the
schema-repair loop.

Generic and self-contained, but with two Piggybudget-specific problems:

1. **No product consumer.** Piggybudget's live notification UI
   (`components/app/finance-notifications.tsx`) is localStorage-only. The real API
   client (`components/app/notifications-popover.tsx`) is unreachable.
2. **Shared scheduler dependency.** It imports
   `github.com/slopstack/slopstack/apps/server/internal/reminders` (§2.5), so the
   two must be extracted together or not at all.

Decision needed: if Piggybudget wants server-side notifications, extract both. If
not, they are dead weight — but `registerReminderScheduler` is wired at `app.go:51`
and runs on every boot today.

### 2.5 `internal/reminders/` (4 files)

Byte-identical to Taskboard (`diff -rq` reports no differences at all).

- `reminder.go` — `Reminder` model, `TargetKind`/`Channel`/`Status` types,
  `New()`, `DeduplicationKey()`, `RetryPolicy.Backoff()`, `delivered()`,
  `deliveryFailed()`
- `memory_store.go` — `MemoryStore` implementing `Store`
- `scheduler.go` — `Store`/`Sender` interfaces, `Scheduler.RunDue`
- `reminders_test.go`

Cleanly generic, no app-specific imports, no collection names. The best-structured
candidate in the repo. Note `MemoryStore` is the only store implementation — the
persistent store is the `reminders` collection, wired in `notifications.go`.

### 2.6 Recurrence — see §4

`internal/calendar/recurrence.go` (187 LOC) is generic iCalendar RRULE expansion, but its only
callers are CalDAV and occurrences. Classified OBSOLETE below rather than
OPTIONAL-SHARED because there is no Piggybudget consumer. If Taskboard's richer
version is extracted upstream, it belongs in the calendar package, not app.

## 3. APP-OWNED — stays in Piggybudget

### 3.1 `internal/app/finance.go` (588 LOC)

`financeCollections` (`accounts`, `transactions`, `checkpoints`, `budgets`,
`assets`, `goals`), `financeFields` allow-lists, `registerFinanceAPI` (the Huma
OpenAPI stubs), `registerFinanceHooks` (checkpoint immutability), and the six-verb
CRUD router registered under both `/api/finance` and `/api`.

Plus domain logic that is Piggybudget-only: `accountSummary`, `accountSummaryRoute`,
`reconcileAccountRoute`, `checkpointWindows`, `moneyEqual`, `financeSort`,
`financeRecordResponse`, `validateTransactionWrite`, `validateFinanceLinks`,
`ownedFinanceRecord`, `financeInput`, `applyFinanceInput`.

Not extractable. The CRUD *shape* (dual-prefix six-verb router with an
owner-scoped field allow-list) is reusable and could be upstreamed as a helper, but
the field tables and the reconciliation logic cannot.

### 3.2 `internal/app/finance_schema.go` (159 LOC)

Six collection definitions with `financeCollectionDefinition`/`financeIndex` structs
and the `financeOwnerRule` constant. Purely Piggybudget. No counterpart in Taskboard
or the template.

### 3.3 `internal/app/asset_groups.go` (351 LOC)

`asset_groups` + `asset_positions` collections, the `assets.asset_group` link field,
`RegisterAssetGroupHooks`, `RegisterAssetGroupRoutes` (dual-prefix), and the
`assetGroupFields`/`assetPositionFields` allow-lists plus validators.

Note it duplicates a large amount of machinery that `finance.go` already has —
same dual-prefix loop, same `CurrentUser` + owned-record lookup, same
`input → allow-list → Set` pattern, same 404-on-wrong-owner. Consolidating the two
is a Piggybudget-internal refactor worth doing before any extraction, so the
upstream helper has one caller shape rather than two.

### 3.4 `internal/app/transaction_attachments.go` (255 LOC)

The `transaction_attachments` collection, protected image file field, MIME-sniffed
upload with all-or-nothing rollback, list/delete routes, and owner validation.

Upload limits (`transaction_attachments.go:22-25`) and the `Protected: true` file
flag are compatibility-critical (R6 in `docs/COMPATIBILITY.md`).

The multipart-upload handler itself could be a generic upstream helper
(max files / max size / MIME allow-list / transactional rollback); the collection
and the transaction link cannot.

### 3.5 Web: `components/budgeting/` (2 files)

`budgeting-dashboard.tsx` and `data.ts`. All six views, all finance API calls,
all reconciliation and asset-group interaction. ~1900 + ~350 LOC, no tests. Entirely
Piggybudget.

### 3.6 Web: `components/app/{auth-screen,finance-search,finance-notifications}.tsx`, `components/sidebar.tsx`

Piggybudget UI. `finance-notifications.tsx` uses localStorage rather than the
`/api/notifications` endpoints — a real divergence from the server surface.

## 4. OBSOLETE-IN-PIGGYBUDGET — inherited Taskboard calendar/DAV, no consumer

Evidence method: (server) is the file wired into `registerRoutes` or a hook, and
does any *Piggybudget-reachable* web file call its route? (web) is the module absent
from the import graph rooted at `apps/web/src/main.tsx`, computed by walking every
relative `from '...'` import. Test files are excluded from that graph — an import in a
test does not make a module used.

### 4.1 Server files

| File | LOC | Registered | Reachable product caller | Verdict |
|---|---|---|---|---|
| `internal/app/caldav.go` | 854 | `/.well-known/caldav`, `/caldav`, `/caldav/{path...}` (`caldav.go:49-51`) | none | **Obsolete** |
| `internal/app/caldav_xml.go` | 139 | no routes | 9 unexported helpers used only by `caldav.go`/`caldav_test.go` | **Obsolete** |
| `internal/app/caldav_changes.go` | 152 | no routes; `EnsureCalDAVChanges` at `app.go:40` creates `caldav_changes` | none — only the CalDAV journal writes it | **Obsolete** |
| `internal/app/carddav.go` | 333 | `/.well-known/carddav`, `/carddav`, `/carddav/{path...}` (`carddav.go:32-34`) | none | **Obsolete** |
| `internal/app/calendar_io.go` | 596 | `POST /api/calendars/import`, `GET /api/calendars/{id}/export.ics` | `settings-tab.tsx:324,527` — **unreachable** | **Obsolete** |
| `internal/app/occurrences.go` | 480 | `/api/calendar/occurrences*` (3 routes) | `create-composer.tsx:238`, `entry-row.tsx:53` — **both unreachable** | **Obsolete** |
| `internal/app/search.go` | 292 | `GET /api/search` | `search-tab.tsx:51` — **unreachable** | **Obsolete for the finance product.** Searches only `todos`/`events`/`lists`/`calendars`/`contacts` (`search.go:65-69`) — zero finance collections. Piggybudget's actual search (`finance-search.tsx`) is client-side over `BudgetData`. |
| `internal/calendar/recurrence.go` | 187 | no routes | imported by `caldav.go:20` and `occurrences.go:17` only | **Obsolete in Piggybudget**; generic code — extract from Taskboard if any app needs it |
| `internal/app/schema.go` (12-collection table) | — | creates `todos`/`events`/`lists`/`calendars`/`address_books`/`contacts`/`audit_logs`/5 permission collections | none; `app.go:54-59` provisions rows for every new user | **Obsolete table**, generic engine is CORE (§1.5) |
| `internal/app/ownership.go` (hooks) | — | binds `todos`/`events`/`lists`/`calendars`/`contacts` | none of those collections is written by the Piggybudget UI | **Obsolete hooks**, generic mechanism is CORE (§1.4) |
| `internal/app/authorization.go` | 15 | no routes | no caller anywhere | **Obsolete stub** (§1.3) |

`internal/reminders/` is **not** obsolete — the scheduler is bound at `app.go:51`
and runs on every boot — but it has no Piggybudget web consumer either (§2.5).

**Not present in Piggybudget** (present in Taskboard): `vcard.go`,
`carddav_changes.go`, `backup_encryption.go`, `backup_formats.go`,
`backup_scheduler.go`, `Config.BackupJSONEnabled`, and `registerTodoRoutes`
(`GET /api/todos`). Piggybudget's `carddav.go` inlines the vCard helpers at lines
250-296 instead of extracting `vcard.go`.

### 4.2 Web files (unreachable from `main.tsx`)

```
components/tabs/calendar-tab.tsx
components/tabs/lists-tab.tsx
components/tabs/people-tab.tsx
components/tabs/search-tab.tsx
components/tabs/settings-tab.tsx
components/tabs/upcoming-tab.tsx
components/time-grid/{index,layout,position,segments,dates,types}.ts
components/time-grid/time-grid.tsx
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
api/generated/**            (16 files)
```

Test files that keep the above compiling and count toward the 34-test baseline:

```
components/tabs/lists-tab.test.tsx
components/time-grid/{layout,position,segments}.test.ts
components/time-grid/time-grid.test.tsx
components/container-manager/container-manager.test.tsx
components/calendar-month.test.tsx
components/full-month-calendar.test.tsx
components/app/create-composer.helpers.test.ts
data.test.ts
theme.test.ts
```

`components/ui/*` (56 shadcn primitives) is also unreachable except `tooltip`, but
that is a vendored component library, **not** inherited Taskboard application code.
Different remediation — keep, prune on size grounds, not obsolescence grounds.

### 4.3 How to re-verify

```sh
# web: recompute the module graph from the production entrypoint
#   (script used in this audit; test files excluded from the graph)
node -e '<walk from apps/web/src/main.tsx, resolve relative + @/ imports>'

# server: routes and their only callers
grep -rn 'Router\.\(GET\|POST\|PUT\|PATCH\|DELETE\|Any\)(' apps/server/internal/app/*.go | grep -v _test
grep -rn 'apiFetch(' apps/web/src        # only reachable callers matter

# cross-repo drift against Taskboard
diff -u ../taskboard/apps/server/internal/app/<file>.go \
        apps/server/internal/app/<file>.go
```

### 4.4 Deletion cost

Removing the OBSOLETE set also removes: `caldav_test.go` (248 LOC),
`carddav_test.go`, `calendar_io_test.go` (391 LOC), `occurrences_test.go` (245 LOC),
`internal/calendar/recurrence_test.go`, and 9 of the 11 vitest files. The Go
`internal/app` suite and the web test count will drop sharply. That is expected and
must be reflected in the `docs/baseline.json` CI diff, or CI will read it as a
regression.

## 5. Extraction order recommendation

Ordered by leverage / risk, not by the classification table:

1. **`auth.go` + `schema.go`'s repair engine.** Byte-identical to Taskboard, zero
   app coupling, and the repair engine is currently duplicated five times in this
   repo. Highest dedup value, lowest risk.
2. **`backup_command.go` from Taskboard** (not Piggybudget's older copy). Adds
   encryption and cron validation. Piggybudget holds financial data.
3. **`internal/reminders/` + `notifications.go` together.** Must move as a pair;
   resolve the "does Piggybudget want server notifications at all" question first.
4. **`ownership.go` generalised** into a spec-driven hook primitive. Requires
   rewriting, not copying — the current file is 100% Taskboard collection names.
5. **`config.go` from Taskboard**, with a `PIGGYBUDGET_*` prefix plus
   `SLOPSTACK_*` deprecated aliases.
6. **`openapi.go` + the `cmd/slopstack` bootstrap**, parameterised.
7. **`guest_auth.go`** with a configurable guest email (fixes the
   `guest@taskboard.local` leak).

Deferred until the app-owned refactor lands: `finance.go`/`asset_groups.go` share a
lot of router and validation machinery; consolidating them first gives the upstream
helper one clean signature instead of two.

Do **not** extract Piggybudget's `caldav.go` or `carddav.go`. They are older and
less capable than Taskboard's; if DAV is ever wanted upstream, take Taskboard's.