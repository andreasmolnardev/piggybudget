# Data model

## Current schema

Core collections are created by `apps/server/internal/app/schema.go` on first boot and persisted by PocketBase. Finance collection definitions live in `apps/server/internal/app/finance_schema.go` and are applied by the finance migration.

| Collection          | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `users`             | Auth records and profile fields                                    |
| `app_passwords`     | User-managed protocol credentials                                  |
| `groups`            | Team or role groups                                                |
| `permissions`       | Named capability definitions                                       |
| `group_permissions` | Group capability assignments                                       |
| `user_permissions`  | User overrides and denies                                          |
| `group_members`     | User membership relationships                                      |
| `accounts`          | Finance account definitions and opening balances                   |
| `transactions`      | Account movements, categories, transfers, and reconciliation flags |
| `checkpoints`       | Account balance checkpoints                                        |
| `budgets`           | Category budget periods and amounts                                |
| `assets`            | Tracked assets and values                                          |
| `goals`             | Savings goals and progress                                         |
| `audit_logs`        | Security and activity history                                      |
| `reminders`         | Scheduled notification work                                        |
| `notifications`     | In-app notification records                                        |

Finance collections have owner fields, access rules, and indexes. The finance API adds owner/link validation and account summaries.

## Finance model status

The current fields are the first storage shape, not the final money model. Before adding more financial calculations, define decimal precision, currency rules, transaction sign, transfer pairing, reconciliation, and budget-period semantics. Add a new PocketBase migration for schema changes. Do not rewrite an applied migration.

## Finance relationships

Transactions remain the source of account movement. A transaction can point to a budget, asset, receivable, receipt, tags, and attachments without creating a second balance system. Assets and goals add meaning to ledger records; they do not independently change account balances.
