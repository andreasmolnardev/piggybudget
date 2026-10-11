package app

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func createFinanceNotification(app core.App, owner, key, title, body, targetKind, targetID string) error {
	matches, err := app.FindRecordsByFilter(
		notificationCollection,
		"reminder_key = {:key}",
		"",
		1,
		0,
		dbx.Params{"key": key},
	)
	if err != nil || len(matches) > 0 {
		return err
	}
	collection, err := app.FindCollectionByNameOrId(notificationCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("owner", owner)
	record.Set("title", title)
	record.Set("body", body)
	record.Set("target_kind", targetKind)
	record.Set("target_id", targetID)
	record.Set("reminder_key", key)
	return app.Save(record)
}

func createBudgetOverrunNotifications(app core.App, owner string, transaction *core.Record) error {
	if transaction.GetString("type") != "expense" {
		return nil
	}
	date := transaction.GetDateTime("date").Time()
	if date.IsZero() {
		return nil
	}
	budgets, err := app.FindRecordsByFilter("budgets", "owner = {:owner} && archived = false", "", 0, 0, dbx.Params{"owner": owner})
	if err != nil {
		return err
	}
	expenses, err := app.FindRecordsByFilter("transactions", "owner = {:owner} && type = 'expense'", "date,id", 0, 0, dbx.Params{"owner": owner})
	if err != nil {
		return err
	}
	for _, budget := range budgets {
		limit := budget.GetFloat("amount")
		if limit <= 0 {
			continue
		}
		start := budget.GetDateTime("start_date").Time()
		end := budget.GetDateTime("end_date").Time()
		if start.IsZero() {
			start = time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
		}
		if end.IsZero() {
			end = time.Date(start.Year(), start.Month()+1, 0, 23, 59, 59, 0, time.UTC)
		}
		if date.Before(start) || date.After(end) {
			continue
		}
		spent := 0.0
		for _, expense := range expenses {
			expenseDate := expense.GetDateTime("date").Time()
			if expenseDate.Before(start) || expenseDate.After(end) {
				continue
			}
			matchesBudget := expense.GetString("budget") == budget.Id
			if expense.GetString("budget") == "" {
				matchesBudget = strings.EqualFold(strings.TrimSpace(expense.GetString("category")), strings.TrimSpace(budget.GetString("category")))
			}
			if matchesBudget {
				spent += math.Abs(expense.GetFloat("amount"))
			}
		}
		if spent <= limit+0.005 {
			continue
		}
		period := start.Format("2006-01")
		key := fmt.Sprintf("budget-overrun-%s-%s", budget.Id, period)
		body := fmt.Sprintf("%s is over its limit by %.2f.", budget.GetString("category"), spent-limit)
		if err := createFinanceNotification(app, owner, key, "Budget limit exceeded", body, "budget", budget.Id); err != nil {
			return err
		}
	}
	return nil
}

func createGoalMilestoneNotifications(app core.App, owner string, goal *core.Record, previous, current float64) error {
	target := goal.GetFloat("target_amount")
	if target <= 0 {
		return nil
	}
	for _, milestone := range []int{25, 50, 75, 100} {
		threshold := target * float64(milestone) / 100
		if previous >= threshold || current < threshold {
			continue
		}
		key := fmt.Sprintf("goal-milestone-%s-%d", goal.Id, milestone)
		body := fmt.Sprintf("%s reached %d%% of its target.", goal.GetString("name"), milestone)
		if err := createFinanceNotification(app, owner, key, "Goal milestone reached", body, "goal", goal.Id); err != nil {
			return err
		}
	}
	return nil
}

func createAccountLowBalanceNotifications(app core.App, owner string) error {
	accounts, err := app.FindRecordsByFilter(
		"accounts",
		"owner = {:owner} && archived = false",
		"name",
		0,
		0,
		dbx.Params{"owner": owner},
	)
	if err != nil {
		return err
	}
	period := time.Now().UTC().Format("2006-01")
	for _, account := range accounts {
		threshold := account.GetFloat("alert_below")
		if threshold <= 0 {
			continue
		}
		summary, err := accountSummary(app, account, owner)
		if err != nil {
			return err
		}
		balance, ok := summary["balance"].(float64)
		if !ok || balance > threshold {
			continue
		}
		body := fmt.Sprintf("%s is at %.2f, below your %.2f alert.", account.GetString("name"), balance, threshold)
		key := fmt.Sprintf("account-low-%s-%s", account.Id, period)
		if err := createFinanceNotification(app, owner, key, "Account balance is low", body, "account", account.Id); err != nil {
			return err
		}
	}
	return nil
}
