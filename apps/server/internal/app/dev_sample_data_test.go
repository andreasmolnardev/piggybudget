package app

import (
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnsureDevSampleDataIsIdempotent(t *testing.T) {
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
	if err := EnsureDevSampleSeedField(testApp); err != nil {
		t.Fatal(err)
	}
	user := testUser(t, testApp, "dev-sample@example.com")

	if err := ensureDevSampleData(testApp, user.Id); err != nil {
		t.Fatal(err)
	}
	accountsBefore, err := testApp.FindRecordsByFilter(
		"accounts", "owner = {:owner}", "id", 0, 0, dbx.Params{"owner": user.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	transactionsBefore, err := testApp.FindRecordsByFilter(
		"transactions", "owner = {:owner}", "id", 0, 0, dbx.Params{"owner": user.Id},
	)
	if err != nil {
		t.Fatal(err)
	}

	if err := ensureDevSampleData(testApp, user.Id); err != nil {
		t.Fatalf("second seed check: %v", err)
	}
	accountsAfter, err := testApp.FindRecordsByFilter(
		"accounts", "owner = {:owner}", "id", 0, 0, dbx.Params{"owner": user.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	transactionsAfter, err := testApp.FindRecordsByFilter(
		"transactions", "owner = {:owner}", "id", 0, 0, dbx.Params{"owner": user.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(accountsBefore) != 3 || len(accountsAfter) != len(accountsBefore) {
		t.Fatalf("account count changed from %d to %d", len(accountsBefore), len(accountsAfter))
	}
	if len(transactionsBefore) != 8 || len(transactionsAfter) != len(transactionsBefore) {
		t.Fatalf("transaction count changed from %d to %d", len(transactionsBefore), len(transactionsAfter))
	}
	if !accountsBefore[0].GetBool("is_default") && !accountsBefore[1].GetBool("is_default") && !accountsBefore[2].GetBool("is_default") {
		t.Fatal("sample accounts have no default account")
	}
}
