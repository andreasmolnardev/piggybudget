package app

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestConsumeSsoLinkIntentIsBoundAndOneTime(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	app.Store().Set("piggybudget-sso-link-intent:once", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(time.Minute)})
	if !consumeSsoLinkIntent(app, "user-a", "once") || consumeSsoLinkIntent(app, "user-a", "once") {
		t.Fatal("intent must be bound and one-time")
	}
	app.Store().Set("piggybudget-sso-link-intent:other", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(time.Minute)})
	if consumeSsoLinkIntent(app, "user-b", "other") || consumeSsoLinkIntent(app, "user-a", "other") {
		t.Fatal("wrong-user attempt must consume intent")
	}
	app.Store().Set("piggybudget-sso-link-intent:expired", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(-time.Minute)})
	if consumeSsoLinkIntent(app, "user-a", "expired") {
		t.Fatal("expired intent accepted")
	}
}

func TestOAuthEmailMatchCannotSilentlyLinkExistingAccount(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("member@example.com")
	user.SetPassword("secret123456")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	event := &core.RecordAuthWithOAuth2RequestEvent{
		RequestEvent: &core.RequestEvent{App: app}, ProviderName: "oidc2",
		OAuth2User: &auth.AuthUser{Id: "idp-1", Email: user.Email()}, Record: user,
	}
	event.Collection = users
	event.Request = httptest.NewRequest("POST", "/api/collections/users/auth-with-oauth2", nil)
	err = validateOAuthAssociation(event, Config{RegistrationMode: RegistrationApproval})
	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) || apiErr.Status != 403 {
		t.Fatalf("email match must be rejected pending explicit link: %v", err)
	}

	linked := core.NewExternalAuth(app)
	linked.SetCollectionRef(users.Id)
	linked.SetRecordRef(user.Id)
	linked.SetProvider("oidc2")
	linked.SetProviderId("idp-1")
	if err := app.Save(linked); err != nil {
		t.Fatal(err)
	}
	if err := validateOAuthAssociation(event, Config{RegistrationMode: RegistrationApproval}); err != nil {
		t.Fatalf("existing provider link must sign in: %v", err)
	}
}

func TestOAuthSignupRequiresProviderEmailWhenVerifiedEmailIsRequired(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RecordAuthWithOAuth2RequestEvent{
		RequestEvent: &core.RequestEvent{App: app}, ProviderName: "oidc2",
		OAuth2User: &auth.AuthUser{Id: "idp-2"}, IsNewRecord: true,
	}
	event.Collection = users
	if err := validateOAuthAssociation(event, Config{RegistrationMode: RegistrationApproval, RequireVerifiedEmail: true}); err == nil {
		t.Fatal("new OAuth account without provider email must fail")
	}
	event.OAuth2User.Email = "verified@example.com"
	if err := validateOAuthAssociation(event, Config{RegistrationMode: RegistrationApproval, RequireVerifiedEmail: true}); err != nil {
		t.Fatalf("provider email should pass requirement: %v", err)
	}
}

func TestOIDCSecretIsPreservedWhenInputIsBlank(t *testing.T) {
	provider := core.OAuth2ProviderConfig{Name: "oidc2", ClientSecret: "saved-secret", Extra: map[string]any{"custom": "keep"}}
	updated := applyOidc2Settings(provider, oidc2SettingsInput{ClientID: "new-client", Issuer: "https://issuer.example"})
	if updated.ClientSecret != "saved-secret" {
		t.Fatal("blank secret input must preserve the saved secret")
	}
	if updated.Extra["custom"] != "keep" {
		t.Fatal("unrelated provider extra settings must be preserved")
	}
	updated = applyOidc2Settings(updated, oidc2SettingsInput{ClientID: "new-client", ClientSecret: "replacement"})
	if updated.ClientSecret != "replacement" {
		t.Fatal("nonblank secret input must replace the saved secret")
	}
}

func TestOIDCSettingsRequireIssuerAndJWKSOverHTTPS(t *testing.T) {
	settings := oidc2SettingsInput{ClientID: "client", Issuer: "https://id.example/", JWKSURL: "https://id.example/keys", AuthURL: "https://id.example/authorize", TokenURL: "https://id.example/token"}
	if err := validateOidc2Settings(settings); err != nil {
		t.Fatalf("valid OIDC settings rejected: %v", err)
	}
	settings.JWKSURL = ""
	if err := validateOidc2Settings(settings); err == nil {
		t.Fatal("OIDC without JWKS must be rejected")
	}
	settings.JWKSURL = "http://id.example/keys"
	if err := validateOidc2Settings(settings); err == nil {
		t.Fatal("insecure OIDC URLs must be rejected")
	}
}

func TestSsoOnlyPasswordPolicyHasLockoutFallback(t *testing.T) {
	c := Config{SSOOnly: true}
	if !ssoOnlyBlocksPassword(c, true, 1) {
		t.Fatal("configured SSO policy should block password login")
	}
	if ssoOnlyBlocksPassword(c, false, 1) || ssoOnlyBlocksPassword(c, true, 0) {
		t.Fatal("password fallback must remain without an active provider")
	}
}

func TestUserEmailCollisionIgnoresCase(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	member := core.NewRecord(users)
	member.SetEmail("member@example.com")
	member.SetPassword("secret123456")
	if err := app.Save(member); err != nil {
		t.Fatal(err)
	}
	candidate := core.NewRecord(users)
	candidate.SetEmail("MEMBER@EXAMPLE.COM")
	collision, err := userEmailCollision(app, candidate)
	if err != nil || !collision {
		t.Fatalf("case variant collision=%v err=%v", collision, err)
	}
}
