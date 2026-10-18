package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnsureFinanceCollectionsCreatesOwnedCollections(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	expectedFields := map[string][]string{
		"transactions": {"type", "budget", "tags", "attachments", "receipt", "asset", "receivable"},
		"assets":       {"type", "quantity", "purchase_date", "purchase_price", "purchase_transaction", "target_sale_price", "status"},
	}
	for _, name := range financeCollections {
		collection, err := testApp.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("%s collection: %v", name, err)
		}
		if collection.Fields.GetByName("owner") == nil {
			t.Fatalf("%s collection has no owner field", name)
		}
		if collection.ListRule == nil || *collection.ListRule != financeOwnerRule {
			t.Fatalf("%s list rule = %v", name, collection.ListRule)
		}
		if collection.CreateRule == nil || *collection.CreateRule != financeOwnerRule {
			t.Fatalf("%s create rule = %v", name, collection.CreateRule)
		}
		for _, field := range expectedFields[name] {
			if collection.Fields.GetByName(field) == nil {
				t.Fatalf("%s collection has no %s field", name, field)
			}
		}
	}
}

func TestRegisterExposesFinanceButNotTodo(t *testing.T) {
	pb := pocketbase.New()
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Piggybudget API", "0.1.0"))
	Register(pb, Config{HTTPAddress: ":8090"}, api)

	document, err := json.Marshal(api.OpenAPI())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(document), `"/api/todos"`) {
		t.Fatal("OpenAPI document exposes /api/todos")
	}
	if !strings.Contains(string(document), `"/api/finance/accounts"`) {
		t.Fatal("OpenAPI document does not contain finance accounts")
	}
}

func TestAccountSummaryCalculatesBalanceAndReconciliation(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	user := testUser(t, testApp, "finance-summary@example.com")
	account := financeTestRecord(t, testApp, "accounts", map[string]any{
		"owner": user.Id, "name": "Checking", "opening_balance": 100,
	})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-01 00:00:00.000Z",
		"amount": 50, "cleared": true,
	})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-15 00:00:00.000Z",
		"amount": -10, "reconciled": true,
	})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-21 00:00:00.000Z",
		"amount": -500, "is_draft": true,
	})
	financeTestRecord(t, testApp, "checkpoints", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-10 00:00:00.000Z",
		"balance": 150,
	})
	financeTestRecord(t, testApp, "checkpoints", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-20 00:00:00.000Z",
		"balance": 140,
	})

	summary, err := accountSummary(testApp, account, user.Id)
	if err != nil {
		t.Fatal(err)
	}
	if summary["balance"] != float64(140) {
		t.Fatalf("balance = %v", summary["balance"])
	}
	if summary["clearedBalance"] != float64(140) {
		t.Fatalf("cleared balance = %v", summary["clearedBalance"])
	}
	if summary["reconciledBalance"] != float64(90) {
		t.Fatalf("reconciled balance = %v", summary["reconciledBalance"])
	}
	if summary["reconciliationDifference"] != float64(0) {
		t.Fatalf("reconciliation difference = %v", summary["reconciliationDifference"])
	}
	windows, ok := summary["checkpointWindows"].([]map[string]any)
	if !ok || len(windows) != 2 {
		t.Fatalf("checkpoint windows = %#v", summary["checkpointWindows"])
	}
	if windows[0]["state"] != "incomplete" || windows[1]["state"] != "reconciled" {
		t.Fatalf("checkpoint window states = %#v", windows)
	}
}

func TestCheckpointWindowMarksMismatchInvalid(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	user := testUser(t, testApp, "finance-invalid-window@example.com")
	account := financeTestRecord(t, testApp, "accounts", map[string]any{
		"owner": user.Id, "name": "Checking", "opening_balance": 100,
	})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-01 00:00:00.000Z", "amount": 10,
	})
	financeTestRecord(t, testApp, "checkpoints", map[string]any{
		"owner": user.Id, "account": account.Id, "date": "2026-09-02 00:00:00.000Z", "balance": 111,
	})

	summary, err := accountSummary(testApp, account, user.Id)
	if err != nil {
		t.Fatal(err)
	}
	windows := summary["checkpointWindows"].([]map[string]any)
	if windows[0]["state"] != "invalid" || windows[0]["unexplained"] != float64(1) {
		t.Fatalf("invalid checkpoint window = %#v", windows[0])
	}
}

func TestFinanceHTTPAPIRequiresAuthAndScopesRecords(t *testing.T) {
	server := newHTTPIntegrationServer(t)
	owner := integrationUser(t, server.app, "finance-owner@example.com")
	other := integrationUser(t, server.app, "finance-other@example.com")
	ownerToken := authToken(t, server, owner.GetString("email"))
	otherToken := authToken(t, server, other.GetString("email"))

	status, _, _ := integrationRequest(t, server, http.MethodGet, "/api/finance/accounts", "", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated finance list = %d, want %d", status, http.StatusUnauthorized)
	}

	status, _, body := integrationRequest(t, server, http.MethodPost, "/api/finance/accounts", `{"name":"Checking","opening_balance":100}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("create account = %d, body = %s", status, body)
	}
	var account map[string]any
	if err := json.Unmarshal([]byte(body), &account); err != nil {
		t.Fatal(err)
	}
	accountID, ok := account["id"].(string)
	if !ok || accountID == "" {
		t.Fatalf("account response has no id: %s", body)
	}

	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/transactions", `{"account":"`+accountID+`","date":"2026-09-01T00:00:00Z","amount":25}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("create transaction = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID+"/summary", "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !containsJSONNumber(body, 125) {
		t.Fatalf("account summary = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/transactions", `{"account":"`+accountID+`","date":"2026-09-01T00:00:00Z","amount":1000,"is_draft":true}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated || !strings.Contains(body, `"is_draft":true`) {
		t.Fatalf("create draft transaction = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID+"/summary", "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !containsJSONNumber(body, 125) {
		t.Fatalf("draft transaction changed account balance = %d, body = %s", status, body)
	}

	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/checkpoints", `{"account":"`+accountID+`","date":"2026-09-01T00:00:00Z","balance":130}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("create checkpoint = %d, body = %s", status, body)
	}
	var checkpoint map[string]any
	if err := json.Unmarshal([]byte(body), &checkpoint); err != nil {
		t.Fatal(err)
	}
	checkpointID, ok := checkpoint["id"].(string)
	if !ok || checkpointID == "" {
		t.Fatalf("checkpoint response has no id: %s", body)
	}

	status, _, body = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID+"/summary", "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !summaryMiscellaneousAmount(t, body, 5) {
		t.Fatalf("unexplained gap missing from miscellaneous bucket: %d, %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/transactions", `{"account":"`+accountID+`","date":"2026-09-02T00:00:00Z","amount":1}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("transaction after checkpoint with a gap = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID+"/summary", "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !containsJSONNumber(body, 131) {
		t.Fatalf("checkpoint was not used as the current balance baseline: %d, %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/transactions", `{"account":"`+accountID+`","date":"2026-08-31T00:00:00Z","amount":2}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("historical backfill = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID+"/summary", "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !summaryMiscellaneousAmount(t, body, 3) {
		t.Fatalf("historical backfill did not reduce miscellaneous bucket: %d, %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/accounts/"+accountID+"/reconcile", "", bearerHeaders(otherToken))
	if status != http.StatusNotFound {
		t.Fatalf("cross-user reconciliation = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/accounts/"+accountID+"/reconcile", "", bearerHeaders(ownerToken))
	if status != http.StatusCreated {
		t.Fatalf("reconcile miscellaneous gap = %d, body = %s", status, body)
	}
	status, _, body = integrationRequest(t, server, http.MethodPost, "/api/finance/transactions", `{"account":"`+accountID+`","date":"2026-09-02T00:00:00Z","amount":1}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusCreated {
		t.Fatalf("transaction after reconciliation = %d, body = %s", status, body)
	}

	status, _, _ = integrationRequest(t, server, http.MethodPatch, "/api/finance/checkpoints/"+checkpointID, `{"note":"blocked"}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusBadRequest {
		t.Fatalf("unconfirmed checkpoint patch = %d, want %d", status, http.StatusBadRequest)
	}
	status, _, _ = integrationRequest(t, server, http.MethodPatch, "/api/finance/checkpoints/"+checkpointID+"?confirm=yes", `{"note":"confirmed"}`, withContentType(bearerHeaders(ownerToken)))
	if status != http.StatusOK {
		t.Fatalf("confirmed checkpoint patch = %d, want %d", status, http.StatusOK)
	}
	status, _, _ = integrationRequest(t, server, http.MethodDelete, "/api/finance/checkpoints/"+checkpointID, "", bearerHeaders(ownerToken))
	if status != http.StatusBadRequest {
		t.Fatalf("unconfirmed checkpoint delete = %d, want %d", status, http.StatusBadRequest)
	}
	status, _, _ = integrationRequest(t, server, http.MethodDelete, "/api/finance/checkpoints/"+checkpointID+"?confirm=yes", "", bearerHeaders(ownerToken))
	if status != http.StatusNoContent {
		t.Fatalf("confirmed checkpoint delete = %d, want %d", status, http.StatusNoContent)
	}

	status, _, _ = integrationRequest(t, server, http.MethodGet, "/api/finance/accounts/"+accountID, "", bearerHeaders(otherToken))
	if status != http.StatusNotFound {
		t.Fatalf("cross-user account read = %d, want %d", status, http.StatusNotFound)
	}
	assertAuditEvent(t, server.app, owner.Id, "create", "accounts", accountID)
	assertAuditEvent(t, server.app, owner.Id, "create", "transactions", "")
	assertAuditEvent(t, server.app, owner.Id, "create", "checkpoints", checkpointID)
	assertAuditEvent(t, server.app, owner.Id, "update", "checkpoints", checkpointID)
	assertAuditEvent(t, server.app, owner.Id, "delete", "checkpoints", checkpointID)
}

func TestFinanceHumaListUsesOwnerScopedListLogic(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	owner := testUser(t, testApp, "finance-huma-owner@example.com")
	other := testUser(t, testApp, "finance-huma-other@example.com")
	account := financeTestRecord(t, testApp, "accounts", map[string]any{"owner": owner.Id, "name": "Checking"})
	otherAccount := financeTestRecord(t, testApp, "accounts", map[string]any{"owner": other.Id, "name": "Private"})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": owner.Id, "account": account.Id, "date": "2026-09-01 00:00:00.000Z", "amount": 12,
	})
	financeTestRecord(t, testApp, "transactions", map[string]any{
		"owner": other.Id, "account": otherAccount.Id, "date": "2026-09-02 00:00:00.000Z", "amount": 99,
	})

	token, err := owner.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("Piggybudget API", "0.1.0"))
	registerFinanceAPI(testApp, api)

	unauthorized := httptest.NewRecorder()
	mux.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/finance/transactions", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated Huma list = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/finance/transactions?account="+account.Id, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("Huma list = %d, body = %s", response.Code, response.Body.String())
	}
	var records []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0]["account"] != account.Id || records[0]["amount"] != float64(12) {
		t.Fatalf("Huma transaction list = %#v", records)
	}
}

func TestNativeFinanceRecordWritesAreAudited(t *testing.T) {
	server := newHTTPIntegrationServer(t)
	owner := integrationUser(t, server.app, "native-finance-audit@example.com")
	token := authToken(t, server, owner.GetString("email"))

	status, _, body := integrationRequest(t, server, http.MethodPost, "/api/collections/accounts/records", `{"owner":"`+owner.Id+`","name":"Native account"}`, withContentType(bearerHeaders(token)))
	if status != http.StatusOK && status != http.StatusCreated {
		t.Fatalf("native account create = %d, body = %s", status, body)
	}
	var account map[string]any
	if err := json.Unmarshal([]byte(body), &account); err != nil {
		t.Fatal(err)
	}
	accountID, ok := account["id"].(string)
	if !ok || accountID == "" {
		t.Fatalf("native account response has no id: %s", body)
	}
	assertAuditEvent(t, server.app, owner.Id, "create", "accounts", accountID)
}

func assertAuditEvent(t *testing.T, app core.App, actorID, action, resource, resourceID string) {
	t.Helper()
	records, err := app.FindRecordsByFilter("audit_logs", "actor = {:actor} && action = {:action}", "", 0, 0, dbx.Params{
		"actor": actorID, "action": action,
	})
	if err != nil {
		t.Fatalf("find %s %s audit event: %v", action, resource, err)
	}
	for _, record := range records {
		metadataBytes, err := json.Marshal(record.Get("metadata"))
		if err != nil {
			t.Fatalf("encode audit metadata: %v", err)
		}
		var metadata map[string]any
		if err := json.Unmarshal(metadataBytes, &metadata); err != nil {
			t.Fatalf("decode audit metadata: %v", err)
		}
		if metadata["resource"] != resource {
			continue
		}
		if resourceID == "" || metadata["resource_id"] == resourceID {
			return
		}
	}
	t.Fatalf("missing audit event actor=%s action=%s resource=%s id=%s", actorID, action, resource, resourceID)
}

func testUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(collection)
	user.SetEmail(email)
	user.SetPassword("password123456")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	return user
}

func financeTestRecord(t *testing.T, app core.App, collectionName string, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	for name, value := range fields {
		record.Set(name, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func summaryMiscellaneousAmount(t *testing.T, body string, want float64) bool {
	t.Helper()
	var response map[string]any
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatalf("decode account summary: %v", err)
	}
	miscellaneous, ok := response["miscellaneous"].(map[string]any)
	if !ok {
		t.Fatalf("account summary has no miscellaneous bucket: %s", body)
	}
	return miscellaneous["amount"] == want
}

func containsJSONNumber(body string, value int) bool {
	var response map[string]any
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		return false
	}
	return response["balance"] == float64(value)
}
