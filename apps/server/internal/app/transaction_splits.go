package app

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type transactionSplitInput struct {
	amount   float64
	category string
	budget   string
}

func registerTransactionSplitRoutes(event *core.ServeEvent, prefix string) {
	event.Router.POST(prefix+"/transactions/split", createTransactionSplitRoute)
	event.Router.DELETE(prefix+"/transactions/splits/{id}", deleteTransactionSplitRoute)
}

func createTransactionSplitRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	amount, ok := input["amount"].(float64)
	if !ok || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return event.BadRequestError("amount must be greater than zero", nil)
	}
	kind := stringValue(input["type"])
	if kind != "expense" && kind != "income" {
		return event.BadRequestError("split transactions must be an expense or income", nil)
	}
	date, err := time.Parse("2006-01-02", stringValue(input["date"]))
	if err != nil {
		return event.BadRequestError("date must use YYYY-MM-DD", nil)
	}
	accountID := stringValue(input["account"])
	account, err := event.App.FindRecordById("accounts", accountID)
	if err != nil || account.GetString("owner") != user.Id || account.GetBool("archived") {
		return event.BadRequestError("account must be active and belong to the current user", nil)
	}
	rawSplits, ok := input["splits"].([]any)
	if !ok || len(rawSplits) < 2 || len(rawSplits) > 20 {
		return event.BadRequestError("split into 2 to 20 entries", nil)
	}
	splits := make([]transactionSplitInput, 0, len(rawSplits))
	var splitTotal float64
	for _, value := range rawSplits {
		fields, ok := value.(map[string]any)
		if !ok {
			return event.BadRequestError("each split entry must be an object", nil)
		}
		part, ok := fields["amount"].(float64)
		if !ok || math.IsNaN(part) || math.IsInf(part, 0) || part <= 0 {
			return event.BadRequestError("split amounts must be greater than zero", nil)
		}
		category := stringValue(fields["category"])
		if category == "" {
			return event.BadRequestError("each split entry needs a category", nil)
		}
		budgetID := stringValue(fields["budget"])
		if budgetID != "" {
			budget, err := event.App.FindRecordById("budgets", budgetID)
			if err != nil || !ownership.IsOwner(budget, "owner", user.Id) || budget.GetBool("archived") {
				return event.BadRequestError("budget must be active and belong to the current user", nil)
			}
		}
		splits = append(splits, transactionSplitInput{
			amount: part, category: category, budget: budgetID,
		})
		splitTotal += part
	}
	if math.Round(splitTotal*100) != math.Round(amount*100) {
		return event.BadRequestError("split amounts must add up to the transaction total", nil)
	}
	groupID, err := newTransactionSplitID()
	if err != nil {
		return err
	}
	collection, err := event.App.FindCollectionByNameOrId("transactions")
	if err != nil {
		return err
	}
	created := make([]map[string]any, 0, len(splits))
	err = event.App.RunInTransaction(func(tx core.App) error {
		for _, split := range splits {
			transaction := core.NewRecord(collection)
			transaction.Set("owner", user.Id)
			transaction.Set("account", accountID)
			transaction.Set("date", date)
			transaction.Set("amount", split.amount)
			if kind == "expense" {
				transaction.Set("amount", -split.amount)
			}
			transaction.Set("type", kind)
			transaction.Set("payee", stringValue(input["payee"]))
			transaction.Set("description", stringValue(input["description"]))
			transaction.Set("category", split.category)
			transaction.Set("budget", split.budget)
			transaction.Set("tags", input["tags"])
			transaction.Set("receipt", stringValue(input["receipt"]))
			transaction.Set("receivable", stringValue(input["receivable"]))
			transaction.Set("notes", stringValue(input["notes"]))
			transaction.Set("split_group", groupID)
			if err := validateTransactionWrite(tx, transaction, user.Id); err != nil {
				return err
			}
			if err := tx.Save(transaction); err != nil {
				return err
			}
			if err := createBudgetOverrunNotifications(tx, user.Id, transaction); err != nil {
				return err
			}
			created = append(created, transaction.PublicExport())
		}
		if err := createAccountLowBalanceNotifications(tx, user.Id); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	logDomainMutation(event, user.Id, "create", "transaction_splits", groupID, map[string]any{"entries": len(created)})
	return event.JSON(http.StatusCreated, map[string]any{"split_group": groupID, "transactions": created})
}

func deleteTransactionSplitRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	groupID := event.Request.PathValue("id")
	records, err := event.App.FindRecordsByFilter(
		"transactions",
		"owner = {:owner} && split_group = {:group}",
		"id",
		0,
		0,
		dbx.Params{"owner": user.Id, "group": groupID},
	)
	if err != nil {
		return err
	}
	if len(records) < 2 {
		return event.NotFoundError("transaction split not found", nil)
	}
	err = event.App.RunInTransaction(func(tx core.App) error {
		for _, record := range records {
			current, err := tx.FindRecordById("transactions", record.Id)
			if err != nil || current.GetString("owner") != user.Id || current.GetString("split_group") != groupID {
				return fmt.Errorf("transaction split not found")
			}
			if err := tx.Delete(current); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "delete", "transaction_splits", groupID, map[string]any{"entries": len(records)})
	return event.NoContent(http.StatusNoContent)
}

func newTransactionSplitID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate split id: %w", err)
	}
	return hex.EncodeToString(value), nil
}
