# Authentication

PocketBase owns the auth lifecycle for the current platform foundation and the Piggybudget workspace.

## Built-in flows

- Login and logout.
- Registration, controlled by `PIGGYBUDGET_REGISTRATION_ENABLED` (`SLOPSTACK_REGISTRATION_ENABLED` remains a deprecated alias).
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

The `/admin/sso` page is superuser-only and configures the custom `oidc2` provider on the `users` auth collection. It supports OIDC discovery or explicit HTTPS authorization/token endpoints; enabled OIDC requires HTTPS issuer and JWKS URLs. Slopstack reads claims from the signed ID token and leaves the user-info endpoint unset so PocketBase validates issuer and signature. PocketBase's OAuth client flow supplies state and PKCE; its native OIDC implementation does not add a nonce. The callback is based on the frontend PocketBase URL (`VITE_API_URL`, or the page origin when unset). The client secret is never loaded into the page; leave its input blank to keep the saved secret. The UI and server prevent deleting the last linked identity. Configure the callback as `{origin}/api/oauth2-redirect`.

## Backend pattern

Protected routes must reject missing `event.Auth` and apply `Authorize` for permission checks. Frontend navigation, sample-data fallback, and conditional rendering are not security controls. Finance records must use the authenticated owner boundary when persistence is wired.

## SSO policy and account access

Set `PIGGYBUDGET_SSO_ONLY=true` to block password sign-in while at least one OAuth provider is enabled. Password sign-in stays available if no provider is configured, to avoid locking out all users. Provider credentials remain in PocketBase settings; this policy does not change them.

`PIGGYBUDGET_REGISTRATION_ENABLED=false` (or the existing `PIGGYBUDGET_REGISTRATION_MODE=disabled`) blocks public password and first-time OAuth registration. Approval and OTP registration still keep new accounts disabled until the current administrator approval or activation flow completes. Set `PIGGYBUDGET_REQUIRE_VERIFIED_EMAIL=true` to reject unverified accounts at sign-in. Disabled users are also rejected on token refresh and each authenticated request, including requests with an older token.

User emails are stored in lowercase and checked case-insensitively to stop duplicate accounts that differ only by letter case. Users cannot change their own admin, disabled, or registration status fields. OAuth identities cannot be attached to another user's account. Linking an identity from Settings requires the current password and a short-lived one-time server intent; the UI keeps at least one linked provider.

An OAuth sign-in can use an identity already linked to that account. PiggyBudget rejects PocketBase's implicit email-match association, so a user must sign in and explicitly link a new identity from Settings. When verified email is required, a new OAuth account is rejected if the provider returns no email. Users without a password can request password recovery from Settings to set one before linking another identity. Password recovery remains available in SSO-only mode so account linking does not lock out OAuth-only users.
