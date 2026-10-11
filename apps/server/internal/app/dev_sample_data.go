package app

import (
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const devSampleSeededField = "dev_sample_seeded"

// EnsureDevSampleSeedField adds the one-time seed marker only to development
// databases. The marker makes an empty sample database stay empty after the
// developer deletes its sample records.
func EnsureDevSampleSeedField(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	if users.Fields.GetByName(devSampleSeededField) != nil {
		return nil
	}
	users.Fields.Add(&core.BoolField{Name: devSampleSeededField, Hidden: true})
	if err := app.Save(users); err != nil {
		return fmt.Errorf("add development sample marker: %w", err)
	}
	return nil
}

// ensureDevSampleData seeds a user's finance records once, on the first
// authenticated finance request in development mode. Existing data is left
// alone, and deleting the seeded records later does not trigger a reseed.
func ensureDevSampleData(app core.App, userID string) error {
	return app.RunInTransaction(func(tx core.App) error {
		user, err := tx.FindRecordById("users", userID)
		if err != nil {
			return err
		}
		if user.GetBool(devSampleSeededField) {
			return ensureDevDefaultAccount(tx, userID)
		}

		for _, collection := range []string{
			"accounts", "transactions", "checkpoints", "budgets", "assets", "goals",
			"asset_groups", "asset_positions",
		} {
			records, err := tx.FindRecordsByFilter(collection, "owner = {:owner}", "", 1, 0, map[string]any{"owner": userID})
			if err != nil {
				return err
			}
			if len(records) > 0 {
				if err := ensureDevDefaultAccount(tx, userID); err != nil {
					return err
				}
				user.Set(devSampleSeededField, true)
				return tx.Save(user)
			}
		}

		if err := seedDevFinanceRecords(tx, userID); err != nil {
			return err
		}
		user.Set(devSampleSeededField, true)
		return tx.Save(user)
	})
}

func ensureDevDefaultAccount(app core.App, owner string) error {
	accounts, err := app.FindRecordsByFilter("accounts", "owner = {:owner}", "created", 0, 0, map[string]any{"owner": owner})
	if err != nil || len(accounts) == 0 {
		return err
	}
	for _, account := range accounts {
		if account.GetBool("is_default") {
			return nil
		}
	}
	accounts[0].Set("is_default", true)
	return app.Save(accounts[0])
}

func seedDevFinanceRecords(app core.App, owner string) error {
	accounts, err := app.FindCollectionByNameOrId("accounts")
	if err != nil {
		return err
	}
	accountIDs := make(map[string]string, 3)
	for _, account := range []struct {
		key, name, kind, currency string
		opening                   float64
	}{
		{key: "checking", name: "Everyday checking", kind: "checking", currency: "USD", opening: 3927.26},
		{key: "savings", name: "Rainy day fund", kind: "savings", currency: "USD", opening: 12450},
		{key: "visa", name: "Blue card", kind: "credit", currency: "USD", opening: -1144.37},
	} {
		record := core.NewRecord(accounts)
		record.Set("owner", owner)
		record.Set("name", account.name)
		record.Set("type", account.kind)
		record.Set("currency", account.currency)
		record.Set("opening_balance", account.opening)
		record.Set("opening_balance_date", sampleDate(2026, time.September, 1))
		record.Set("is_default", account.key == "checking")
		if err := app.Save(record); err != nil {
			return err
		}
		accountIDs[account.key] = record.Id
	}

	budgets, err := app.FindCollectionByNameOrId("budgets")
	if err != nil {
		return err
	}
	budgetIDs := make(map[string]string, 4)
	for _, budget := range []struct {
		category string
		amount   float64
	}{
		{category: "Home", amount: 1800},
		{category: "Groceries", amount: 600},
		{category: "Dining & fun", amount: 450},
		{category: "Transport", amount: 350},
	} {
		record := core.NewRecord(budgets)
		record.Set("owner", owner)
		record.Set("name", budget.category)
		record.Set("category", budget.category)
		record.Set("amount", budget.amount)
		record.Set("start_date", sampleDate(2026, time.September, 1))
		record.Set("end_date", sampleDate(2026, time.September, 30))
		if err := app.Save(record); err != nil {
			return err
		}
		budgetIDs[budget.category] = record.Id
	}

	transactions, err := app.FindCollectionByNameOrId("transactions")
	if err != nil {
		return err
	}
	transactionRows := []struct {
		date                  time.Time
		amount                float64
		kind, payee, category string
		account, budget       string
	}{
		{date: sampleDate(2026, time.September, 18), amount: -86.42, kind: "expense", payee: "Whole Foods Market", category: "Groceries", account: "checking", budget: "Groceries"},
		{date: sampleDate(2026, time.September, 17), amount: 4200, kind: "income", payee: "Acme Co. Payroll", category: "Income", account: "checking"},
		{date: sampleDate(2026, time.September, 16), amount: -142.8, kind: "expense", payee: "Northstar Energy", category: "Home", account: "checking", budget: "Home"},
		{date: sampleDate(2026, time.September, 15), amount: -64.25, kind: "expense", payee: "Moss & Pine", category: "Dining", account: "visa", budget: "Dining & fun"},
		{date: sampleDate(2026, time.September, 14), amount: -32, kind: "expense", payee: "Metro Transit", category: "Transport", account: "visa", budget: "Transport"},
		{date: sampleDate(2026, time.September, 13), amount: -79, kind: "expense", payee: "Lumen Internet", category: "Subscriptions", account: "checking"},
		{date: sampleDate(2026, time.September, 12), amount: -48.9, kind: "expense", payee: "Parkside Market", category: "Groceries", account: "checking", budget: "Groceries"},
		{date: sampleDate(2026, time.September, 11), amount: 650, kind: "income", payee: "Freelance transfer", category: "Income", account: "checking"},
	}
	checkingDelta := 0.0
	for _, transaction := range transactionRows {
		record := core.NewRecord(transactions)
		record.Set("owner", owner)
		record.Set("account", accountIDs[transaction.account])
		record.Set("date", transaction.date)
		record.Set("amount", transaction.amount)
		record.Set("type", transaction.kind)
		record.Set("payee", transaction.payee)
		record.Set("category", transaction.category)
		if transaction.budget != "" {
			record.Set("budget", budgetIDs[transaction.budget])
		}
		if err := app.Save(record); err != nil {
			return err
		}
		if transaction.account == "checking" {
			checkingDelta += transaction.amount
		}
	}

	assets, err := app.FindCollectionByNameOrId("assets")
	if err != nil {
		return err
	}
	for _, asset := range []struct {
		name, kind  string
		value, cost float64
	}{
		{name: "Index funds", kind: "Brokerage", value: 18420, cost: 16000},
		{name: "Retirement", kind: "401(k)", value: 48200, cost: 39000},
		{name: "Emergency fund", kind: "Cash", value: 12450, cost: 12450},
	} {
		record := core.NewRecord(assets)
		record.Set("owner", owner)
		record.Set("name", asset.name)
		record.Set("type", asset.kind)
		record.Set("value", asset.value)
		record.Set("purchase_price", asset.cost)
		record.Set("currency", "USD")
		record.Set("as_of", sampleDate(2026, time.September, 18))
		if err := app.Save(record); err != nil {
			return err
		}
	}

	goals, err := app.FindCollectionByNameOrId("goals")
	if err != nil {
		return err
	}
	for _, goal := range []struct {
		name       string
		current    float64
		target     float64
		targetDate time.Time
	}{
		{name: "Home down payment", current: 28600, target: 50000, targetDate: sampleDate(2027, time.June, 1)},
		{name: "Japan trip", current: 3200, target: 6000, targetDate: sampleDate(2027, time.March, 1)},
		{name: "New bike", current: 850, target: 1800, targetDate: sampleDate(2026, time.December, 1)},
	} {
		record := core.NewRecord(goals)
		record.Set("owner", owner)
		record.Set("name", goal.name)
		record.Set("current_amount", goal.current)
		record.Set("target_amount", goal.target)
		record.Set("target_date", goal.targetDate)
		if err := app.Save(record); err != nil {
			return err
		}
	}

	checkpoints, err := app.FindCollectionByNameOrId("checkpoints")
	if err != nil {
		return err
	}
	checkpoint := core.NewRecord(checkpoints)
	checkpoint.Set("owner", owner)
	checkpoint.Set("account", accountIDs["checking"])
	checkpoint.Set("date", sampleDate(2026, time.September, 20))
	checkpoint.Set("balance", 3927.26+checkingDelta+190.12)
	checkpoint.Set("note", "Sample statement balance")
	return app.Save(checkpoint)
}

func sampleDate(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
