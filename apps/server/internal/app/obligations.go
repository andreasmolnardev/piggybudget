package app

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func registerObligationRoutes(event *core.ServeEvent, prefix string) {
	event.Router.POST(prefix+"/obligations/{id}/settlements", settleObligationRoute)
}

func validateObligationInput(app core.App, input map[string]any, owner string) error {
	side := stringValue(input["side"])
	if side != "receivable" && side != "payable" {
		return fmt.Errorf("side must be receivable or payable")
	}
	if stringValue(input["party"]) == "" || stringValue(input["title"]) == "" {
		return fmt.Errorf("party and title are required")
	}
	amount, ok := input["amount"].(float64)
	if !ok || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return fmt.Errorf("amount must be greater than zero")
	}
	if dueDate := stringValue(input["due_date"]); dueDate != "" {
		if _, err := time.Parse("2006-01-02", dueDate); err != nil {
			return fmt.Errorf("due date must use YYYY-MM-DD")
		}
	}
	transactionID := stringValue(input["source_transaction"])
	if transactionID == "" {
		return nil
	}
	transaction, err := app.FindRecordById("transactions", transactionID)
	if err != nil || transaction.GetString("owner") != owner {
		return fmt.Errorf("source transaction not found")
	}
	if amount > math.Abs(transaction.GetFloat("amount"))+0.005 {
		return fmt.Errorf("obligation cannot exceed the source transaction amount")
	}
	linked, err := app.FindRecordsByFilter(
		"obligations",
		"owner = {:owner} && source_transaction = {:transaction}",
		"id",
		0,
		0,
		map[string]any{"owner": owner, "transaction": transactionID},
	)
	if err != nil {
		return err
	}
	allocated := amount
	for _, record := range linked {
		allocated += record.GetFloat("amount")
	}
	if allocated > math.Abs(transaction.GetFloat("amount"))+0.005 {
		return fmt.Errorf("linked obligations cannot exceed the source transaction amount")
	}
	if side == "receivable" && transaction.GetFloat("amount") >= 0 {
		return fmt.Errorf("money owed to you must link to an outgoing transaction")
	}
	if side == "payable" && transaction.GetFloat("amount") <= 0 {
		return fmt.Errorf("money you owe must link to an incoming transaction")
	}
	return nil
}

func createObligationRecord(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	if err := validateObligationInput(event.App, input, user.Id); err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	collection, err := event.App.FindCollectionByNameOrId("obligations")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("owner", user.Id)
	applyFinanceInput(record, "obligations", input)
	record.Set("outstanding_amount", input["amount"])
	record.Set("status", "open")
	err = event.App.RunInTransaction(func(tx core.App) error {
		if sourceID := record.GetString("source_transaction"); sourceID != "" {
			source, err := tx.FindRecordById("transactions", sourceID)
			if err != nil || source.GetString("owner") != user.Id {
				return fmt.Errorf("source transaction not found")
			}
			if record.GetString("side") == "receivable" {
				budgetAmount := source.GetFloat("budget_amount")
				if budgetAmount <= 0 {
					budgetAmount = math.Abs(source.GetFloat("amount"))
				}
				source.Set("budget_amount", math.Max(0, budgetAmount-record.GetFloat("amount")))
			} else {
				incomeAmount := source.GetFloat("income_amount")
				if incomeAmount <= 0 {
					incomeAmount = math.Abs(source.GetFloat("amount"))
				}
				incomeAmount = math.Max(0, incomeAmount-record.GetFloat("amount"))
				source.Set("income_amount", incomeAmount)
				if incomeAmount <= 0.005 {
					source.Set("income_amount", 0)
					source.Set("type", "adjustment")
				}
			}
			if err := tx.Save(source); err != nil {
				return err
			}
		}
		return tx.Save(record)
	})
	if err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	logDomainMutation(event, user.Id, "create", "obligations", record.Id, nil)
	return event.JSON(http.StatusCreated, record.PublicExport())
}

func settleObligationRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	obligation, err := ownedFinanceRecord(event, "obligations", user.Id)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	amount, ok := input["amount"].(float64)
	if !ok || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > obligation.GetFloat("outstanding_amount")+0.005 {
		return event.BadRequestError("settlement must be positive and no greater than the outstanding amount", nil)
	}
	settlementDate, err := time.Parse("2006-01-02", stringValue(input["date"]))
	if err != nil {
		return event.BadRequestError("date must use YYYY-MM-DD", nil)
	}
	transactionID := stringValue(input["transaction"])
	accountID := stringValue(input["account"])
	var transaction *core.Record
	err = event.App.RunInTransaction(func(tx core.App) error {
		current, err := tx.FindRecordById("obligations", obligation.Id)
		if err != nil || current.GetString("owner") != user.Id {
			return fmt.Errorf("obligation not found")
		}
		if amount > current.GetFloat("outstanding_amount")+0.005 {
			return fmt.Errorf("settlement exceeds the remaining balance")
		}
		if transactionID != "" {
			transaction, err = tx.FindRecordById("transactions", transactionID)
			if err != nil || transaction.GetString("owner") != user.Id {
				return fmt.Errorf("repayment transaction not found")
			}
			if math.Abs(math.Abs(transaction.GetFloat("amount"))-amount) > 0.005 {
				return fmt.Errorf("settlement amount must match the linked transaction")
			}
			if current.GetString("side") == "receivable" && transaction.GetFloat("amount") <= 0 {
				return fmt.Errorf("a repayment received must be an incoming transaction")
			}
			if current.GetString("side") == "payable" && transaction.GetFloat("amount") >= 0 {
				return fmt.Errorf("a repayment made must be an outgoing transaction")
			}
			transaction.Set("type", "adjustment")
			transaction.Set("budget", "")
			transaction.Set("budget_amount", 0)
			transaction.Set("income_amount", 0)
			if err := tx.Save(transaction); err != nil {
				return err
			}
		} else {
			account, err := tx.FindRecordById("accounts", accountID)
			if err != nil || account.GetString("owner") != user.Id || account.GetBool("archived") {
				return fmt.Errorf("choose an active account")
			}
			transactions, err := tx.FindCollectionByNameOrId("transactions")
			if err != nil {
				return err
			}
			transaction = core.NewRecord(transactions)
			transaction.Set("owner", user.Id)
			transaction.Set("account", account.Id)
			transaction.Set("date", settlementDate)
			transaction.Set("amount", amount)
			transaction.Set("type", "adjustment")
			transaction.Set("category", "Repayment")
			transaction.Set("payee", repaymentPayee(current))
			transaction.Set("description", "Settlement for "+current.GetString("title"))
			if current.GetString("side") == "payable" {
				transaction.Set("amount", -amount)
			}
			if err := validateTransactionWrite(tx, transaction, user.Id); err != nil {
				return err
			}
			if err := tx.Save(transaction); err != nil {
				return err
			}
		}
		settlements, err := tx.FindCollectionByNameOrId("settlements")
		if err != nil {
			return err
		}
		settlement := core.NewRecord(settlements)
		settlement.Set("owner", user.Id)
		settlement.Set("obligation", current.Id)
		settlement.Set("transaction", transaction.Id)
		settlement.Set("amount", amount)
		settlement.Set("date", settlementDate)
		settlement.Set("notes", stringValue(input["notes"]))
		if err := tx.Save(settlement); err != nil {
			return err
		}
		remaining := math.Max(0, current.GetFloat("outstanding_amount")-amount)
		current.Set("outstanding_amount", remaining)
		if remaining <= 0.005 {
			current.Set("outstanding_amount", 0)
			current.Set("status", "settled")
		}
		if err := tx.Save(current); err != nil {
			return err
		}
		obligation = current
		return createAccountLowBalanceNotifications(tx, user.Id)
	})
	if err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	logDomainMutation(event, user.Id, "settle", "obligations", obligation.Id, map[string]any{
		"transaction_id": transaction.Id, "amount": amount,
	})
	return event.JSON(http.StatusCreated, map[string]any{
		"obligation": obligation.PublicExport(), "transaction": transaction.PublicExport(),
	})
}

func repaymentPayee(obligation *core.Record) string {
	if obligation.GetString("side") == "receivable" {
		return "Repayment from " + strings.TrimSpace(obligation.GetString("party"))
	}
	return "Repayment to " + strings.TrimSpace(obligation.GetString("party"))
}
