package app

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func registerSSOAuthHooks(pb *pocketbase.PocketBase, config Config) {
	pb.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			info, _ := e.RequestInfo()
			isOAuth := info != nil && info.Context == core.RequestInfoContextOAuth2
			if config.RegistrationMode == RegistrationDisabled && !isOAuth {
				return e.ForbiddenError("registration is disabled", nil)
			}
			e.Record.Set("isAdmin", false)
			if isOAuth {
				e.Record.Set("disabled", true)
				if config.RegistrationMode == RegistrationOTP {
					e.Record.Set("activation_code", activationCode())
					e.Record.Set("registration_status", "awaiting_activation")
				} else {
					e.Record.Set("registration_status", "awaiting_approval")
				}
			}
		}
		e.Record.SetEmail(strings.ToLower(strings.TrimSpace(e.Record.Email())))
		collision, err := userEmailCollision(e.App, e.Record)
		if err != nil {
			return e.InternalServerError("could not check email uniqueness", err)
		}
		if collision {
			return e.BadRequestError("an account already uses this email address", nil)
		}
		return e.Next()
	})
	pb.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			if e.Record.GetBool("disabled") != e.Record.Original().GetBool("disabled") || e.Record.GetString("registration_status") != e.Record.Original().GetString("registration_status") {
				return e.ForbiddenError("only an administrator can change account access", nil)
			}
			e.Record.Set("isAdmin", e.Record.Original().GetBool("isAdmin"))
		}
		if !strings.EqualFold(e.Record.Email(), e.Record.Original().Email()) {
			e.Record.SetEmail(strings.ToLower(strings.TrimSpace(e.Record.Email())))
			collision, err := userEmailCollision(e.App, e.Record)
			if err != nil {
				return e.InternalServerError("could not check email uniqueness", err)
			}
			if collision {
				return e.BadRequestError("an account already uses this email address", nil)
			}
		}
		return e.Next()
	})
	pb.OnRecordDeleteRequest(core.CollectionNameExternalAuths).BindFunc(func(e *core.RecordRequestEvent) error {
		return protectLastExternalAuth(e)
	})
	pb.OnRecordAuthWithOAuth2Request().BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if err := validateOAuthAssociation(e, config); err != nil {
			return err
		}
		return e.Next()
	})
	pb.OnRecordAuthWithPasswordRequest("users").BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		collection, err := e.App.FindCollectionByNameOrId("users")
		if err != nil || !ssoOnlyBlocksPassword(config, collection.OAuth2.Enabled, len(collection.OAuth2.Providers)) {
			return e.Next()
		}
		return e.ForbiddenError("password sign-in is disabled by workspace policy", nil)
	})
	pb.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("account is disabled", nil)
		}
		if config.RequireVerifiedEmail && !e.Record.Verified() {
			return e.ForbiddenError("verify your email before signing in", nil)
		}
		return e.Next()
	})
	pb.OnRecordAuthRefreshRequest("users").BindFunc(func(e *core.RecordAuthRefreshRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("account is disabled", nil)
		}
		return e.Next()
	})
}

func protectLastExternalAuth(e *core.RecordRequestEvent) error {
	if e.HasSuperuserAuth() {
		return e.Next()
	}
	user, err := e.App.FindRecordById("users", e.Record.GetString("recordRef"))
	if err != nil {
		return e.ForbiddenError("cannot remove the last connected sign-in identity", nil)
	}
	identities, err := e.App.FindAllExternalAuthsByRecord(user)
	if err != nil {
		return e.InternalServerError("could not check connected identities", err)
	}
	if len(identities) <= 1 {
		return e.ForbiddenError("cannot remove the last connected sign-in identity", nil)
	}
	return e.Next()
}

type oidc2SettingsInput struct {
	Enabled      bool   `json:"enabled"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Issuer       string `json:"issuer"`
	JWKSURL      string `json:"jwksURL"`
	AuthURL      string `json:"authURL"`
	TokenURL     string `json:"tokenURL"`
	UserInfoURL  string `json:"userInfoURL"`
}

type oidc2SettingsResponse struct {
	Enabled     bool   `json:"enabled"`
	ClientID    string `json:"clientId"`
	Issuer      string `json:"issuer"`
	JWKSURL     string `json:"jwksURL"`
	AuthURL     string `json:"authURL"`
	TokenURL    string `json:"tokenURL"`
	UserInfoURL string `json:"userInfoURL"`
}

func ssoAdminSettings(event *core.RequestEvent) error {
	if !event.HasSuperuserAuth() {
		return event.ForbiddenError("superuser access is required", nil)
	}
	collection, err := event.App.FindCollectionByNameOrId("users")
	if err != nil {
		return event.InternalServerError("could not load user auth settings", err)
	}
	provider, found := collection.OAuth2.GetProviderConfig("oidc2")
	if event.Request.Method == http.MethodGet {
		return event.JSON(http.StatusOK, oidc2SettingsResponse{
			Enabled:  collection.OAuth2.Enabled,
			ClientID: provider.ClientId,
			Issuer:   firstIssuer(provider.Extra["issuers"]),
			JWKSURL:  stringExtra(provider.Extra["jwksURL"]),
			AuthURL:  provider.AuthURL, TokenURL: provider.TokenURL, UserInfoURL: provider.UserInfoURL,
		})
	}
	if event.Request.Method != http.MethodPut {
		return event.BadRequestError("method not supported", nil)
	}
	var input oidc2SettingsInput
	if err := json.NewDecoder(event.Request.Body).Decode(&input); err != nil {
		return event.BadRequestError("invalid OIDC settings", err)
	}
	if input.Enabled {
		if err := validateOidc2Settings(input); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	if !found {
		provider = core.OAuth2ProviderConfig{Name: "oidc2"}
	}
	provider = applyOidc2Settings(provider, input)
	collection.OAuth2.Enabled = input.Enabled
	if found {
		for i := range collection.OAuth2.Providers {
			if collection.OAuth2.Providers[i].Name == "oidc2" {
				collection.OAuth2.Providers[i] = provider
				break
			}
		}
	} else {
		collection.OAuth2.Providers = append(collection.OAuth2.Providers, provider)
	}
	if err := event.App.Save(collection); err != nil {
		return event.BadRequestError("could not save OIDC settings", err)
	}
	return event.JSON(http.StatusOK, map[string]bool{"saved": true})
}

func applyOidc2Settings(provider core.OAuth2ProviderConfig, input oidc2SettingsInput) core.OAuth2ProviderConfig {
	provider.Name = "oidc2"
	provider.ClientId = strings.TrimSpace(input.ClientID)
	if input.ClientSecret != "" {
		provider.ClientSecret = input.ClientSecret
	}
	provider.AuthURL = strings.TrimSpace(input.AuthURL)
	provider.TokenURL = strings.TrimSpace(input.TokenURL)
	// Keep user-info disabled so PocketBase validates signed ID-token claims
	// against the configured issuer and JWKS instead of trusting an endpoint.
	provider.UserInfoURL = ""
	pkce := true
	provider.PKCE = &pkce
	if provider.Extra == nil {
		provider.Extra = map[string]any{}
	}
	if issuer := strings.TrimSpace(input.Issuer); issuer != "" {
		provider.Extra["issuers"] = []string{issuer}
	} else {
		delete(provider.Extra, "issuers")
	}
	if jwksURL := strings.TrimSpace(input.JWKSURL); jwksURL != "" {
		provider.Extra["jwksURL"] = jwksURL
	} else {
		delete(provider.Extra, "jwksURL")
	}
	return provider
}

func validateOidc2Settings(input oidc2SettingsInput) error {
	if strings.TrimSpace(input.ClientID) == "" || strings.TrimSpace(input.Issuer) == "" || strings.TrimSpace(input.JWKSURL) == "" {
		return errors.New("enabled custom OIDC requires a client ID, issuer, and JWKS URL")
	}
	for _, value := range []string{input.Issuer, input.JWKSURL, input.AuthURL, input.TokenURL} {
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Hostname() != "localhost") {
			return errors.New("custom OIDC issuer, JWKS, authorization, and token URLs must use HTTPS")
		}
	}
	return nil
}

func firstIssuer(value any) string {
	switch issuers := value.(type) {
	case []string:
		if len(issuers) > 0 {
			return issuers[0]
		}
	case []any:
		if len(issuers) > 0 {
			issuer, _ := issuers[0].(string)
			return issuer
		}
	}
	return ""
}

func stringExtra(value any) string { result, _ := value.(string); return result }

func validateOAuthAssociation(e *core.RecordAuthWithOAuth2RequestEvent, config Config) error {
	if e.IsNewRecord && config.RegistrationMode == RegistrationDisabled && !e.HasSuperuserAuth() {
		return e.ForbiddenError("registration is disabled", nil)
	}
	if config.RequireVerifiedEmail && e.IsNewRecord && (e.OAuth2User == nil || strings.TrimSpace(e.OAuth2User.Email) == "") {
		return e.ForbiddenError("the identity provider did not return a verified email address", nil)
	}
	userAuth := e.Auth != nil && e.Auth.Collection().Name == "users"
	if userAuth {
		if e.Record != nil && e.Record.Id != e.Auth.Id {
			return e.ForbiddenError("this identity is linked to another account", nil)
		}
		if !consumeSsoLinkIntent(e.App, e.Auth.Id, e.Request.Header.Get("X-PiggyBudget-Link-Intent")) {
			return e.ForbiddenError("reauthenticate and confirm linking before adding an identity", nil)
		}
		return nil
	}
	if e.Record == nil {
		return nil
	}
	if e.OAuth2User == nil {
		return e.ForbiddenError("could not validate the provider identity", nil)
	}
	externalAuth, err := e.App.FindFirstExternalAuthByExpr(dbx.HashExp{
		"collectionRef": e.Collection.Id,
		"provider":      e.ProviderName,
		"providerId":    e.OAuth2User.Id,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return e.InternalServerError("could not validate the provider identity", err)
	}
	if externalAuth == nil || externalAuth.RecordRef() != e.Record.Id {
		return e.ForbiddenError("sign in to the existing account and explicitly link this identity", nil)
	}
	return nil
}

func userEmailCollision(app core.App, record *core.Record) (bool, error) {
	email := strings.TrimSpace(record.Email())
	if email == "" {
		return false, nil
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return false, err
	}
	var exists int
	err = app.RecordQuery(users).Select("(1)").AndWhere(dbx.NewExp("lower([[email]]) = lower({:email}) AND [[id]] != {:id}", dbx.Params{"email": email, "id": record.Id})).Limit(1).Row(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func ssoOnlyBlocksPassword(config Config, oauthEnabled bool, providerCount int) bool {
	return config.SSOOnly && oauthEnabled && providerCount > 0
}

type ssoLinkIntent struct {
	UserID    string
	ExpiresAt time.Time
}

var ssoLinkIntentMu sync.Mutex

func consumeSsoLinkIntent(app core.App, userID, intent string) bool {
	if intent == "" {
		return false
	}
	ssoLinkIntentMu.Lock()
	defer ssoLinkIntentMu.Unlock()
	key := "piggybudget-sso-link-intent:" + intent
	entry, ok := app.Store().Get(key).(ssoLinkIntent)
	app.Store().Remove(key)
	return ok && entry.UserID == userID && time.Now().Before(entry.ExpiresAt)
}

func createSsoLinkIntent(event *core.RequestEvent) error {
	if event.Auth == nil || event.Auth.Collection().Name != "users" {
		return event.UnauthorizedError("sign in first", nil)
	}
	var input struct {
		Password string `json:"password"`
	}
	if json.NewDecoder(event.Request.Body).Decode(&input) != nil || input.Password == "" || !event.Auth.ValidatePassword(input.Password) {
		return event.ForbiddenError("confirm your password to link a sign-in method", nil)
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return event.InternalServerError("could not create link intent", err)
	}
	intent := hex.EncodeToString(random)
	event.App.Store().Set("piggybudget-sso-link-intent:"+intent, ssoLinkIntent{UserID: event.Auth.Id, ExpiresAt: time.Now().Add(5 * time.Minute)})
	return event.JSON(http.StatusOK, map[string]string{"intent": intent})
}
