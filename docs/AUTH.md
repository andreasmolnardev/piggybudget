# Authentication

PocketBase owns the auth lifecycle for the current platform foundation and the Piggybudget workspace.

## Built-in flows

- Login and logout.
- Registration, controlled by `SLOPSTACK_REGISTRATION_ENABLED`.
- Password reset.
- Email verification.
- Persistent auth tokens.
- Auth record access through `pb.authStore`.

## Frontend pattern

```ts
await pb.collection('users').authWithPassword(email, password);
const user = pb.authStore.record;
pb.authStore.clear();
```

Current routes are `/auth/login`, `/auth/register`, and `/settings`. App routes require a valid PocketBase auth record. Logout clears `pb.authStore` and returns to `/auth/login`.

The admin console at `/admin/users` manages users through PocketBase's superuser-protected collection API. `/admin/sso` configures OAuth2 providers on the `users` auth collection. Register each provider with `{origin}/api/oauth2-redirect`.

## Backend pattern

Protected routes must reject missing `event.Auth` and apply `Authorize` for permission checks. Frontend navigation, sample-data fallback, and conditional rendering are not security controls. Finance records must use the authenticated owner boundary when persistence is wired.
