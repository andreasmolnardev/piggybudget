# Navigation

## Piggybudget routes

The current web shell exposes the first finance workspace:

| Area         | Route            | Current purpose                     |
| ------------ | ---------------- | ----------------------------------- |
| Dashboard    | `/`              | Finance summary and recent activity |
| Transactions | `/transactions`  | Review and filter account movements |
| Budgets      | `/budgets`       | Review budget limits and spending   |
| Assets       | `/assets`        | Review tracked assets and net worth |
| Goals        | `/goals`         | Review savings goals and progress   |
| Settings     | `/settings`      | Account and workspace settings      |
| Login        | `/auth/login`    | PocketBase sign-in                  |
| Register     | `/auth/register` | PocketBase registration             |

Some finance actions are currently presentation-only, and sample fallback data can appear when remote records are unavailable. Account and transaction create/edit flows are next work.

## Mobile

The sidebar collapses below the `lg` breakpoint. A fixed bottom navigation exposes the finance workspace views. Account actions remain in the top-right profile control.

## Interaction rules

- Active navigation uses shadcn `Button` with the `secondary` variant.
- Primary creation uses one visible action for the current finance module.
- Destructive actions stay secondary and require clear labels.
- API docs open in a separate tab from the sidebar.
