package server_test

import (
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	app "github.com/piggybudget/piggybudget/apps/server/internal/app"
	_ "github.com/piggybudget/piggybudget/apps/server/pb_migrations"
)

func TestSyntheticLegacyFinanceSchemaUpgradePreservesRecords(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()

	user := createLegacyUser(t, testApp, "legacy-finance@example.com")
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	dropCollectionForLegacyFixture(t, testApp, "transaction_attachments")
	dropCollectionForLegacyFixture(t, testApp, "accounts")
	dropCollectionForLegacyFixture(t, testApp, "transactions")
	accountCollection := createLegacyCollection(t, testApp, "accounts",
		&core.TextField{Name: "owner", Required: true},
		&core.TextField{Name: "name", Required: true},
		&core.NumberField{Name: "opening_balance"},
	)
	transactionCollection := createLegacyCollection(t, testApp, "transactions",
		&core.TextField{Name: "owner", Required: true},
		&core.TextField{Name: "account", Required: true},
		&core.DateField{Name: "date", Required: true},
		&core.NumberField{Name: "amount"},
		&core.TextField{Name: "payee"},
		&core.TextField{Name: "description"},
	)

	account := core.NewRecord(accountCollection)
	account.Set("owner", user.Id)
	account.Set("name", "Legacy checking")
	account.Set("opening_balance", 125.5)
	if err := testApp.Save(account); err != nil {
		t.Fatal(err)
	}
	transaction := core.NewRecord(transactionCollection)
	transaction.Set("owner", user.Id)
	transaction.Set("account", account.Id)
	transaction.Set("date", "2025-04-03 00:00:00.000Z")
	transaction.Set("amount", -18.75)
	transaction.Set("payee", "Legacy market")
	transaction.Set("description", "Imported transaction")
	if err := testApp.Save(transaction); err != nil {
		t.Fatal(err)
	}

	// Simulate an installed older release: retain the legacy schema and records,
	// but clear the disposable app's current app-migration history so the current
	// migration set is applied to that schema.
	clearAppMigrationHistory(t, testApp)
	for range 2 {
		if err := testApp.RunAppMigrations(); err != nil {
			t.Fatalf("run app migrations: %v", err)
		}
		if err := runCurrentPiggybudgetBootstrap(testApp); err != nil {
			t.Fatalf("run current bootstrap schema repairs: %v", err)
		}
	}

	assertCollectionAndRecordSurvived(t, testApp, "accounts", accountCollection.Id, account.Id, map[string]any{
		"owner": user.Id, "name": "Legacy checking", "opening_balance": float64(125.5),
	})
	assertCollectionAndRecordSurvived(t, testApp, "users", users.Id, user.Id, map[string]any{"email": "legacy-finance@example.com"})
	assertCollectionAndRecordSurvived(t, testApp, "transactions", transactionCollection.Id, transaction.Id, map[string]any{
		"owner": user.Id, "account": account.Id, "amount": float64(-18.75), "payee": "Legacy market", "description": "Imported transaction",
	})

	accounts, err := testApp.FindCollectionByNameOrId("accounts")
	if err != nil {
		t.Fatal(err)
	}
	if accounts.Fields.GetByName("currency") == nil {
		t.Fatal("upgrade did not add the account currency field")
	}
	transactions, err := testApp.FindCollectionByNameOrId("transactions")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"type", "tags", "attachments", "cleared", "reconciled"} {
		if transactions.Fields.GetByName(field) == nil {
			t.Errorf("upgrade did not add transaction field %q", field)
		}
	}
}

func runCurrentPiggybudgetBootstrap(testApp core.App) error {
	if err := app.EnsureCollections(testApp); err != nil {
		return err
	}
	if err := app.EnsureAssetGroupCollections(testApp); err != nil {
		return err
	}
	if err := app.EnsureTransactionAttachmentCollection(testApp); err != nil {
		return err
	}
	if err := app.EnsureNotificationCollections(testApp); err != nil {
		return err
	}
	return app.EnsureCalDAVChanges(testApp)
}

func createLegacyUser(t *testing.T, testApp core.App, email string) *core.Record {
	t.Helper()
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail(email)
	user.SetPassword("legacy-user-password-123")
	if err := testApp.Save(user); err != nil {
		t.Fatal(err)
	}
	return user
}

func createLegacyCollection(t *testing.T, testApp core.App, name string, fields ...core.Field) *core.Collection {
	t.Helper()
	collection := core.NewBaseCollection(name)
	for _, field := range fields {
		collection.Fields.Add(field)
	}
	if err := testApp.Save(collection); err != nil {
		t.Fatalf("create legacy %s collection: %v", name, err)
	}
	return collection
}

func dropCollectionForLegacyFixture(t *testing.T, testApp core.App, name string) {
	t.Helper()
	collection, err := testApp.FindCollectionByNameOrId(name)
	if err != nil {
		return
	}
	if err := testApp.Delete(collection); err != nil {
		t.Fatalf("drop fresh %s collection in disposable fixture: %v", name, err)
	}
}

func clearAppMigrationHistory(t *testing.T, testApp core.App) {
	t.Helper()
	for _, migration := range core.AppMigrations.Items() {
		if _, err := testApp.DB().Delete(core.DefaultMigrationsTable, dbx.HashExp{"file": migration.File}).Execute(); err != nil {
			t.Fatalf("clear disposable migration history for %s: %v", migration.File, err)
		}
	}
}

func assertCollectionAndRecordSurvived(t *testing.T, testApp core.App, name, collectionID, recordID string, values map[string]any) {
	t.Helper()
	collection, err := testApp.FindCollectionByNameOrId(name)
	if err != nil {
		t.Fatal(err)
	}
	if collection.Id != collectionID {
		t.Errorf("%s collection ID changed: got %q, want %q", name, collection.Id, collectionID)
	}
	record, err := testApp.FindRecordById(name, recordID)
	if err != nil {
		t.Fatalf("find preserved %s record: %v", name, err)
	}
	if record.Id != recordID {
		t.Errorf("%s record ID changed: got %q, want %q", name, record.Id, recordID)
	}
	for field, want := range values {
		if got := record.Get(field); got != want {
			t.Errorf("%s.%s = %#v, want %#v", name, field, got, want)
		}
	}
}
