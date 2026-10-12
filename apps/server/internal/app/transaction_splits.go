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
	name     string
	amount   float64
	category string
	budget   string
}

func registerTransactionSplitRoutes(event *core.ServeEvent, prefix string) {
	event.Router.POST(prefix+"/transactions/split", createTransactionSplitRoute)
	event.Router.PUT(prefix+"/transactions/splits/{id}", updateTransactionSplitRoute)
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
		return event.BadRequestError("add 2 to 20 subtransactions", nil)
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
		name := stringValue(fields["name"])
		if name == "" {
			return event.BadRequestError("each subtransaction needs a name", nil)
		}
		category := stringValue(fields["category"])
		budgetID := stringValue(fields["budget"])
		if budgetID != "" {
			budget, err := event.App.FindRecordById("budgets", budgetID)
			if err != nil || !ownership.IsOwner(budget, "owner", user.Id) || budget.GetBool("archived") {
				return event.BadRequestError("budget must be active and belong to the current user", nil)
			}
		}
		splits = append(splits, transactionSplitInput{
			name: name, amount: part, category: category, budget: budgetID,
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
	created := make([]map[string]any, 0, len(splits)+1)
	err = event.App.RunInTransaction(func(tx core.App) error {
		parent := core.NewRecord(collection)
		parent.Set("owner", user.Id)
		parent.Set("account", accountID)
		parent.Set("date", date)
		parentAmount := amount
		if kind == "expense" {
			parentAmount = -amount
		}
		parent.Set("amount", parentAmount)
		parent.Set("type", kind)
		parent.Set("payee", stringValue(input["payee"]))
		parent.Set("description", stringValue(input["description"]))
		parent.Set("tags", input["tags"])
		parent.Set("receipt", stringValue(input["receipt"]))
		parent.Set("notes", stringValue(input["notes"]))
		parent.Set("budget_amount", 0)
		parentIncomeAmount := 0.0
		if kind == "income" {
			parentIncomeAmount = amount
		}
		parent.Set("income_amount", parentIncomeAmount)
		parent.Set("split_group", groupID)
		if err := validateTransactionWrite(tx, parent, user.Id); err != nil {
			return err
		}
		if err := tx.Save(parent); err != nil {
			return err
		}
		created = append(created, parent.PublicExport())

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
			transaction.Set("payee", split.name)
			transaction.Set("description", stringValue(input["payee"]))
			transaction.Set("category", split.category)
			transaction.Set("budget", split.budget)
			if kind == "expense" {
				transaction.Set("budget_amount", split.amount)
			} else {
				transaction.Set("income_amount", split.amount)
			}
			transaction.Set("parent_transaction", parent.Id)
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

func updateTransactionSplitRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	groupID := event.Request.PathValue("id")
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
		return event.BadRequestError("subtransactions must be an expense or income", nil)
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
	groupRecords, err := event.App.FindRecordsByFilter(
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
	var parent *core.Record
	var previousChildren []*core.Record
	for _, record := range groupRecords {
		if record.GetString("parent_transaction") == "" {
			if parent != nil {
				return event.BadRequestError("split group has more than one parent", nil)
			}
			parent = record
		} else {
			previousChildren = append(previousChildren, record)
		}
	}
	if parent == nil || len(previousChildren) < 2 {
		return event.NotFoundError("parent transaction not found", nil)
	}
	for _, record := range groupRecords {
		for _, collection := range []string{"obligations", "settlements"} {
			field := "source_transaction"
			if collection == "settlements" {
				field = "transaction"
			}
			linked, err := event.App.FindRecordsByFilter(
				collection,
				"owner = {:owner} && "+field+" = {:transaction}",
				"id",
				1,
				0,
				dbx.Params{"owner": user.Id, "transaction": record.Id},
			)
			if err != nil {
				return err
			}
			if len(linked) > 0 {
				return event.BadRequestError("subtransactions linked to debt history cannot be edited", nil)
			}
		}
	}
	rawSplits, ok := input["splits"].([]any)
	if !ok || len(rawSplits) < 2 || len(rawSplits) > 20 {
		return event.BadRequestError("add 2 to 20 subtransactions", nil)
	}
	splits := make([]transactionSplitInput, 0, len(rawSplits))
	var splitTotal float64
	for _, value := range rawSplits {
		fields, ok := value.(map[string]any)
		if !ok {
			return event.BadRequestError("each subtransaction must be an object", nil)
		}
		part, ok := fields["amount"].(float64)
		if !ok || math.IsNaN(part) || math.IsInf(part, 0) || part <= 0 {
			return event.BadRequestError("subtransaction amounts must be greater than zero", nil)
		}
		name := stringValue(fields["name"])
		if name == "" {
			return event.BadRequestError("each subtransaction needs a name", nil)
		}
		category := stringValue(fields["category"])
		budgetID := stringValue(fields["budget"])
		if budgetID != "" {
			budget, err := event.App.FindRecordById("budgets", budgetID)
			if err != nil || !ownership.IsOwner(budget, "owner", user.Id) || budget.GetBool("archived") {
				return event.BadRequestError("budget must be active and belong to the current user", nil)
			}
		}
		splits = append(splits, transactionSplitInput{name: name, amount: part, category: category, budget: budgetID})
		splitTotal += part
	}
	if math.Round(splitTotal*100) != math.Round(amount*100) {
		return event.BadRequestError("subtransaction amounts must add up to the parent total", nil)
	}
	collection, err := event.App.FindCollectionByNameOrId("transactions")
	if err != nil {
		return err
	}
	err = event.App.RunInTransaction(func(tx core.App) error {
		currentParent, err := tx.FindRecordById("transactions", parent.Id)
		if err != nil || currentParent.GetString("owner") != user.Id || currentParent.GetString("split_group") != groupID {
			return fmt.Errorf("parent transaction not found")
		}
		parentAmount := amount
		if kind == "expense" {
			parentAmount = -amount
		}
		currentParent.Set("account", accountID)
		currentParent.Set("date", date)
		currentParent.Set("amount", parentAmount)
		currentParent.Set("type", kind)
		currentParent.Set("payee", stringValue(input["payee"]))
		currentParent.Set("description", stringValue(input["description"]))
		currentParent.Set("tags", input["tags"])
		currentParent.Set("receipt", stringValue(input["receipt"]))
		currentParent.Set("notes", stringValue(input["notes"]))
		currentParent.Set("category", "")
		currentParent.Set("budget", "")
		currentParent.Set("budget_amount", 0)
		parentIncomeAmount := 0.0
		if kind == "income" {
			parentIncomeAmount = amount
		}
		currentParent.Set("income_amount", parentIncomeAmount)
		if err := validateTransactionWrite(tx, currentParent, user.Id); err != nil {
			return err
		}
		if err := tx.Save(currentParent); err != nil {
			return err
		}
		for _, child := range previousChildren {
			currentChild, err := tx.FindRecordById("transactions", child.Id)
			if err != nil || currentChild.GetString("owner") != user.Id || currentChild.GetString("split_group") != groupID {
				return fmt.Errorf("subtransaction not found")
			}
			if err := tx.Delete(currentChild); err != nil {
				return err
			}
		}
		for _, split := range splits {
			child := core.NewRecord(collection)
			child.Set("owner", user.Id)
			child.Set("account", accountID)
			child.Set("date", date)
			childAmount := split.amount
			if kind == "expense" {
				childAmount = -split.amount
			}
			child.Set("amount", childAmount)
			child.Set("type", kind)
			child.Set("payee", split.name)
			child.Set("description", stringValue(input["payee"]))
			child.Set("category", split.category)
			child.Set("budget", split.budget)
			if kind == "expense" {
				child.Set("budget_amount", split.amount)
			} else {
				child.Set("income_amount", split.amount)
			}
			child.Set("parent_transaction", currentParent.Id)
			child.Set("split_group", groupID)
			if err := validateTransactionWrite(tx, child, user.Id); err != nil {
				return err
			}
			if err := tx.Save(child); err != nil {
				return err
			}
			if err := createBudgetOverrunNotifications(tx, user.Id, child); err != nil {
				return err
			}
		}
		return createAccountLowBalanceNotifications(tx, user.Id)
	})
	if err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	logDomainMutation(event, user.Id, "update", "transaction_splits", groupID, map[string]any{"entries": len(splits) + 1})
	updatedParent, err := event.App.FindRecordById("transactions", parent.Id)
	if err != nil {
		return err
	}
	response, err := financeRecordResponse(event.App, "transactions", updatedParent, user.Id)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, response)
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
	for _, record := range records {
		for _, collection := range []string{"obligations", "settlements"} {
			field := "source_transaction"
			if collection == "settlements" {
				field = "transaction"
			}
			linked, err := event.App.FindRecordsByFilter(
				collection,
				"owner = {:owner} && "+field+" = {:transaction}",
				"id",
				1,
				0,
				dbx.Params{"owner": user.Id, "transaction": record.Id},
			)
			if err != nil {
				return err
			}
			if len(linked) > 0 {
				return event.BadRequestError("transaction splits linked to debt history cannot be deleted", nil)
			}
		}
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
