package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnsureAssetGroupCollectionsAddsOwnerScopedSchema(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAssetGroupCollections(testApp); err != nil {
		t.Fatal(err)
	}

	for collectionName, fields := range map[string][]string{
		"asset_groups":    {"owner", "name", "description", "currency", "notes", "archived"},
		"asset_positions": {"owner", "group", "name", "quantity", "value", "purchase_date", "purchase_price", "target_sale_price"},
	} {
		collection, err := testApp.FindCollectionByNameOrId(collectionName)
		if err != nil {
			t.Fatal(err)
		}
		if collection.ListRule == nil || *collection.ListRule != assetGroupOwnerRule {
			t.Fatalf("%s list rule = %v, want owner rule", collectionName, collection.ListRule)
		}
		for _, field := range fields {
			if collection.Fields.GetByName(field) == nil {
				t.Errorf("%s has no %q field", collectionName, field)
			}
		}
	}
	assets, err := testApp.FindCollectionByNameOrId("assets")
	if err != nil {
		t.Fatal(err)
	}
	if assets.Fields.GetByName("asset_group") == nil {
		t.Fatal("assets has no asset_group field")
	}
}

func TestAssetPositionsKeepIndependentPurchaseAndTargetSaleValues(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAssetGroupCollections(testApp); err != nil {
		t.Fatal(err)
	}

	owner := testUser(t, testApp, "asset-group-owner@example.com")
	group := financeTestRecord(t, testApp, "asset_groups", map[string]any{"owner": owner.Id, "name": "Index fund"})
	position := financeTestRecord(t, testApp, "asset_positions", map[string]any{
		"owner": owner.Id, "group": group.Id, "name": "Example fund",
		"quantity": 3, "value": 450, "purchase_price": 300, "target_sale_price": 600,
	})
	if position.GetFloat("purchase_price") != 300 || position.GetFloat("target_sale_price") != 600 {
		t.Fatalf("purchase/target values = %v/%v", position.GetFloat("purchase_price"), position.GetFloat("target_sale_price"))
	}
	if err := validateAssetGroupInput(testApp, "asset_positions", map[string]any{"group": group.Id}, nil, owner.Id); err != nil {
		t.Fatalf("valid owner group rejected: %v", err)
	}
	other := testUser(t, testApp, "asset-group-other@example.com")
	if err := validateAssetGroupInput(testApp, "asset_positions", map[string]any{"group": group.Id}, nil, other.Id); err == nil {
		t.Fatal("cross-owner asset group was accepted")
	}
}

func TestAssetGroupRoutesCreatePositionsAndEnforceOwnerScope(t *testing.T) {
	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:       t.TempDir(),
		DefaultDev:           false,
		DefaultEncryptionEnv: "pb_asset_groups_test_env",
	})
	if err := pb.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := EnsureCollections(pb); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAssetGroupCollections(pb); err != nil {
		t.Fatal(err)
	}
	router, err := apis.NewRouter(pb)
	if err != nil {
		t.Fatal(err)
	}
	RegisterAssetGroupRoutes(&core.ServeEvent{App: pb, Router: router, Server: &http.Server{}})
	handler, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(func() {
		server.Close()
		pb.ResetBootstrapState()
	})
	integration := &httpIntegrationServer{app: pb, server: server, client: server.Client()}

	owner := integrationUser(t, pb, "asset-group-route-owner@example.com")
	other := integrationUser(t, pb, "asset-group-route-other@example.com")
	asset := financeTestRecord(t, pb, "assets", map[string]any{
		"owner": owner.Id, "name": "Fund", "purchase_price": 300, "target_sale_price": 700,
	})
	ownerToken := authToken(t, integration, owner.GetString("email"))
	otherToken := authToken(t, integration, other.GetString("email"))
	ownerHeaders := bearerHeaders(ownerToken)
	ownerHeaders.Set("Content-Type", "application/json")
	otherHeaders := bearerHeaders(otherToken)
	otherHeaders.Set("Content-Type", "application/json")

	status, _, body := integrationRequest(t, integration, http.MethodPost, "/api/finance/asset-groups", `{"name":"Index fund"}`, ownerHeaders)
	if status != http.StatusCreated {
		t.Fatalf("group create = %d, %s", status, body)
	}
	var group map[string]any
	if err := json.Unmarshal([]byte(body), &group); err != nil {
		t.Fatal(err)
	}
	groupID := group["id"].(string)
	assertAuditEvent(t, pb, owner.Id, "create", "asset_groups", groupID)

	status, _, body = integrationRequest(t, integration, http.MethodPatch, "/api/finance/assets/"+asset.Id+"/group", `{"asset_group":"`+groupID+`"}`, ownerHeaders)
	if status != http.StatusOK {
		t.Fatalf("asset group assignment = %d, %s", status, body)
	}
	assertAuditEvent(t, pb, owner.Id, "update", "assets", asset.Id)
	if status, _, body = integrationRequest(t, integration, http.MethodPost, "/api/finance/asset-positions", `{"group":"`+groupID+`","name":"Holding","quantity":2,"value":450,"purchase_price":300,"target_sale_price":600}`, ownerHeaders); status != http.StatusCreated {
		t.Fatalf("position create = %d, %s", status, body)
	} else {
		var position map[string]any
		if err := json.Unmarshal([]byte(body), &position); err != nil {
			t.Fatal(err)
		}
		if position["purchase_price"] != float64(300) || position["target_sale_price"] != float64(600) {
			t.Fatalf("position purchase/target values = %#v/%#v", position["purchase_price"], position["target_sale_price"])
		}
		assertAuditEvent(t, pb, owner.Id, "create", "asset_positions", position["id"].(string))
	}

	status, _, _ = integrationRequest(t, integration, http.MethodGet, "/api/finance/asset-groups/"+groupID, "", otherHeaders)
	if status != http.StatusNotFound {
		t.Fatalf("other user's group read = %d, want 404", status)
	}
	status, _, _ = integrationRequest(t, integration, http.MethodPost, "/api/finance/asset-positions", `{"group":"`+groupID+`","name":"Foreign position"}`, otherHeaders)
	if status != http.StatusBadRequest {
		t.Fatalf("other user's group link = %d, want 400", status)
	}
}
