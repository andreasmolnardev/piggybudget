package app

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const maxRecurringOccurrencesPerRule = 100

func validateRecurringTransaction(record *core.Record) error {
	if record.GetString("account") == "" {
		return fmt.Errorf("recurring transaction requires an account")
	}
	amount := record.GetFloat("amount")
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount == 0 {
		return fmt.Errorf("amount must be non-zero")
	}
	switch record.GetString("type") {
	case "expense":
		if amount >= 0 {
			return fmt.Errorf("expense amount must be negative")
		}
	case "income":
		if amount <= 0 {
			return fmt.Errorf("income amount must be positive")
		}
	case "adjustment":
	default:
		return fmt.Errorf("type must be expense, income, or adjustment")
	}
	switch record.GetString("frequency") {
	case "daily", "weekly", "monthly", "yearly":
	default:
		return fmt.Errorf("frequency must be daily, weekly, monthly, or yearly")
	}
	interval := record.GetFloat("interval")
	if interval < 1 || interval > 365 || math.Trunc(interval) != interval {
		return fmt.Errorf("interval must be a whole number from 1 to 365")
	}
	start := record.GetDateTime("start_date").Time()
	next := record.GetDateTime("next_date").Time()
	if start.IsZero() || next.IsZero() {
		return fmt.Errorf("start and next dates are required")
	}
	end := record.GetDateTime("end_date").Time()
	if !end.IsZero() && end.Before(start) {
		return fmt.Errorf("end date must be on or after start date")
	}
	return nil
}

// RunDueRecurringTransactions creates each due occurrence and advances its rule
// in the same transaction, so a restart cannot generate the same occurrence twice.
func RunDueRecurringTransactions(app core.App, now time.Time) (int, error) {
	now = now.UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, time.UTC)
	rules, err := app.FindRecordsByFilter(
		"recurring_transactions",
		"active = true && next_date <= {:today}",
		"next_date,id",
		100,
		0,
		dbx.Params{"today": today},
	)
	if err != nil {
		return 0, err
	}
	created := 0
	for _, candidate := range rules {
		count, err := runDueRecurringRule(app, candidate.Id, today)
		created += count
		if err != nil {
			return created, err
		}
	}
	return created, nil
}

func registerRecurringTransactionScheduler(app core.App) {
	app.Cron().MustAdd("recurring-finance-transactions", "* * * * *", func() {
		if _, err := RunDueRecurringTransactions(app, time.Now()); err != nil {
			app.Logger().Error("run recurring finance transactions", "error", err)
		}
	})
}

func runDueRecurringRule(app core.App, ruleID string, today time.Time) (int, error) {
	created := 0
	err := app.RunInTransaction(func(tx core.App) error {
		rule, err := tx.FindRecordById("recurring_transactions", ruleID)
		if err != nil || !rule.GetBool("active") {
			return nil
		}
		account, err := tx.FindRecordById("accounts", rule.GetString("account"))
		if err != nil || !ownership.IsOwner(account, "owner", rule.GetString("owner")) || account.GetBool("archived") {
			rule.Set("active", false)
			return tx.Save(rule)
		}
		collection, err := tx.FindCollectionByNameOrId("transactions")
		if err != nil {
			return err
		}
		for occurrence := 0; occurrence < maxRecurringOccurrencesPerRule; occurrence++ {
			due := rule.GetDateTime("next_date").Time()
			if due.IsZero() || due.After(today) {
				break
			}
			end := rule.GetDateTime("end_date").Time()
			if !end.IsZero() && due.After(end) {
				rule.Set("active", false)
				break
			}
			transaction := core.NewRecord(collection)
			transaction.Set("owner", rule.GetString("owner"))
			transaction.Set("account", account.Id)
			transaction.Set("date", due)
			transaction.Set("amount", rule.GetFloat("amount"))
			transaction.Set("type", rule.GetString("type"))
			transaction.Set("payee", rule.GetString("payee"))
			transaction.Set("description", rule.GetString("description"))
			transaction.Set("category", rule.GetString("category"))
			transaction.Set("budget", rule.GetString("budget"))
			transaction.Set("tags", rule.Get("tags"))
			transaction.Set("receivable", rule.GetString("receivable"))
			transaction.Set("notes", rule.GetString("notes"))
			transaction.Set("recurring_rule", rule.Id)
			transaction.Set("recurring_date", due)
			if err := validateScheduledTransactionWrite(tx, transaction, rule.GetString("owner")); err != nil {
				return fmt.Errorf("recurring transaction %s on %s: %w", rule.Id, due.Format("2006-01-02"), err)
			}
			if err := tx.Save(transaction); err != nil {
				return err
			}
			if err := createBudgetOverrunNotifications(tx, rule.GetString("owner"), transaction); err != nil {
				return err
			}
			if err := createAccountLowBalanceNotifications(tx, rule.GetString("owner")); err != nil {
				return err
			}
			created++
			if err := (audit.PocketBaseRecorder{App: tx}).Log(context.Background(), audit.Event{
				ActorID: rule.GetString("owner"), Action: "create", Resource: "transactions", ResourceID: transaction.Id,
				Metadata: map[string]any{"source": "recurring_rule", "rule_id": rule.Id, "recurring_date": due.Format("2006-01-02")},
			}); err != nil {
				tx.Logger().Error("write recurring transaction audit event", "transaction_id", transaction.Id, "error", err)
			}
			rule.Set("next_date", nextRecurringDate(
				due,
				rule.GetDateTime("start_date").Time(),
				rule.GetString("frequency"),
				int(rule.GetFloat("interval")),
			))
			if !end.IsZero() && rule.GetDateTime("next_date").Time().After(end) {
				rule.Set("active", false)
				break
			}
		}
		return tx.Save(rule)
	})
	return created, err
}

func nextRecurringDate(date, start time.Time, frequency string, interval int) time.Time {
	switch frequency {
	case "daily":
		return date.AddDate(0, 0, interval)
	case "weekly":
		return date.AddDate(0, 0, 7*interval)
	case "monthly":
		return addMonthsClamped(date, interval, start.Day())
	case "yearly":
		return addMonthsClamped(date, 12*interval, start.Day())
	default:
		return date
	}
}

func addMonthsClamped(date time.Time, months, anchorDay int) time.Time {
	first := time.Date(date.Year(), date.Month()+time.Month(months), 1, date.Hour(), date.Minute(), date.Second(), date.Nanosecond(), date.Location())
	lastDay := time.Date(first.Year(), first.Month()+1, 0, date.Hour(), date.Minute(), date.Second(), date.Nanosecond(), date.Location()).Day()
	day := anchorDay
	if day > lastDay {
		day = lastDay
	}
	return time.Date(first.Year(), first.Month(), day, date.Hour(), date.Minute(), date.Second(), date.Nanosecond(), date.Location())
}
