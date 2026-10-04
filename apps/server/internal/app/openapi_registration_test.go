package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/pocketbase"
)

func TestRegisterMakesFinanceOperationAvailableBeforeServe(t *testing.T) {
	pb := pocketbase.New()
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Piggybudget API", "0.1.0"))

	Register(pb, Config{HTTPAddress: ":8090", PublicURL: "http://localhost:8090"}, api)

	document, err := json.Marshal(api.OpenAPI())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(document), `"/api/finance/accounts"`) {
		t.Fatal("OpenAPI document does not contain finance accounts before server start")
	}
	if strings.Contains(string(document), `"/api/todos"`) {
		t.Fatal("OpenAPI document exposes the removed todo endpoint")
	}
}
