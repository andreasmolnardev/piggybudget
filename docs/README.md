# Piggybudget documentation

These docs describe the current repository: a Go/PocketBase platform and the Piggybudget finance workspace.

The finance workspace covers accounts, transactions, budgets, assets, and goals at the UI/data-adapter level. The server now has owner-scoped finance collections, protected CRUD routes, account summaries, and tests. Sample fallback data and embedded money calculations remain known limits.

The finance workspace is the Piggybudget product definition. Starter modules outside the finance surface are not supported product workflows.

## Guides

- [Colors](./COLORS.md)
- [Navigation](./NAVIGATION.md)
- [Components](./COMPONENTS.md)
- [API](./API.md)
- [Data model](./DATA-MODEL.md)
- [Authentication](./AUTH.md)
- [Development](./DEVELOPMENT.md)
- [Deployment](./DEPLOYMENT.md)

When finance work changes the schema or API, update the data model, API, navigation, and tests together. Preserve applied PocketBase migrations and regenerate API/client output after API changes.
