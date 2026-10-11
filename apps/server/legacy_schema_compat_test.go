package server_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/archive"

	_ "github.com/piggybudget/piggybudget/apps/server/pb_migrations"
)

func TestHistoricalFinanceBackupUpgradePreservesRecords(t *testing.T) {
	financeMigration := findAppMigration(t, "20260920000000_add_finance_collections.go")
	legacyApp := newTestAppWithMigrations(t, financeMigration)
	defer legacyApp.Cleanup()

	// Let the app-owned historical migration define the fixture schema, then add
	// representative data. This avoids reproducing the schema by hand in tests.
	users, err := legacyApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("legacy-finance@example.com")
	user.SetPassword("legacy-user-password-123")
	if err := legacyApp.Save(user); err != nil {
		t.Fatal(err)
	}

	accounts, err := legacyApp.FindCollectionByNameOrId("accounts")
	if err != nil {
		t.Fatal(err)
	}
	account := core.NewRecord(accounts)
	account.Set("owner", user.Id)
	account.Set("name", "Legacy checking")
	account.Set("opening_balance", 125.5)
	if err := legacyApp.Save(account); err != nil {
		t.Fatal(err)
	}

	transactions, err := legacyApp.FindCollectionByNameOrId("transactions")
	if err != nil {
		t.Fatal(err)
	}
	transaction := core.NewRecord(transactions)
	transaction.Set("owner", user.Id)
	transaction.Set("account", account.Id)
	transaction.Set("date", "2025-04-03 00:00:00.000Z")
	transaction.Set("amount", -18.75)
	transaction.Set("payee", "Legacy market")
	transaction.Set("description", "Imported transaction")
	if err := legacyApp.Save(transaction); err != nil {
		t.Fatal(err)
	}

	legacyArchive := "piggybudget_legacy_populated.zip"
	if err := legacyApp.CreateBackup(context.Background(), legacyArchive); err != nil {
		t.Fatalf("create populated historical backup: %v", err)
	}
	legacyDataDir := t.TempDir()
	archivePath := filepath.Join(legacyApp.DataDir(), core.LocalBackupsDirName, legacyArchive)
	if err := archive.Extract(archivePath, legacyDataDir); err != nil {
		t.Fatalf("extract populated historical backup fixture: %v", err)
	}

	// Booting the extracted backup with the complete current registry applies
	// newer migrations to the historical database before assertions run.
	upgradedApp, err := tests.NewTestApp(legacyDataDir)
	if err != nil {
		t.Fatalf("boot current app from populated historical backup: %v", err)
	}
	defer upgradedApp.Cleanup()

	assertCollectionAndRecordSurvived(t, upgradedApp, "users", users.Id, user.Id, map[string]any{
		"email": "legacy-finance@example.com",
	})
	assertCollectionAndRecordSurvived(t, upgradedApp, "accounts", accounts.Id, account.Id, map[string]any{
		"owner": user.Id, "name": "Legacy checking", "opening_balance": float64(125.5),
	})
	assertCollectionAndRecordSurvived(t, upgradedApp, "transactions", transactions.Id, transaction.Id, map[string]any{
		"owner": user.Id, "account": account.Id, "amount": float64(-18.75),
		"payee": "Legacy market", "description": "Imported transaction",
	})

	for _, collectionName := range []string{"transaction_attachments", "asset_groups", "asset_positions"} {
		if _, err := upgradedApp.FindCollectionByNameOrId(collectionName); err != nil {
			t.Errorf("current migrations did not add %s: %v", collectionName, err)
		}
	}
}

func findAppMigration(t *testing.T, filename string) *core.Migration {
	t.Helper()
	for _, migration := range core.AppMigrations.Items() {
		if migration.File == filename {
			return migration
		}
	}
	t.Fatalf("app migration %q is not registered", filename)
	return nil
}

func newTestAppWithMigrations(t *testing.T, migrations ...*core.Migration) *tests.TestApp {
	t.Helper()
	registered := append([]*core.Migration(nil), core.AppMigrations.Items()...)
	core.AppMigrations = core.MigrationsList{}
	for _, migration := range migrations {
		core.AppMigrations.Add(migration)
	}

	// Restore the package registry as soon as the legacy app has booted so the
	// rest of the test and other tests use the complete current migration set.
	defer func() {
		core.AppMigrations = core.MigrationsList{}
		for _, migration := range registered {
			core.AppMigrations.Add(migration)
		}
	}()

	legacyApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("boot app with historical migrations: %v", err)
	}
	return legacyApp
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
