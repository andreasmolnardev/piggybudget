package app

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

var financeCollections = []string{"accounts", "transactions", "checkpoints", "budgets", "assets", "goals", "recurring_transactions", "obligations", "settlements"}

var financeFields = map[string]map[string]bool{
	"accounts": {
		"name": true, "type": true, "currency": true, "opening_balance": true,
		"opening_balance_date": true, "alert_below": true, "notes": true, "archived": true, "is_default": true,
	},
	"transactions": {
		"account": true, "date": true, "amount": true, "type": true, "payee": true, "description": true,
		"category": true, "budget": true, "tags": true, "attachments": true, "receipt": true,
		"asset": true, "receivable": true, "notes": true, "cleared": true, "reconciled": true,
	},
	"checkpoints": {
		"account": true, "date": true, "balance": true, "note": true,
	},
	"budgets": {
		"name": true, "category": true, "amount": true, "start_date": true,
		"end_date": true, "notes": true, "archived": true,
	},
	"assets": {
		"name": true, "type": true, "value": true, "quantity": true, "currency": true, "purchase_date": true,
		"purchase_price": true, "purchase_transaction": true, "target_sale_price": true, "as_of": true,
		"notes": true, "status": true, "archived": true,
	},
	"goals": {
		"name": true, "target_amount": true, "current_amount": true, "target_date": true,
		"account": true, "notes": true, "completed": true, "archived": true, "status": true,
	},
	"recurring_transactions": {
		"account": true, "amount": true, "type": true, "payee": true, "description": true,
		"category": true, "budget": true, "tags": true, "receivable": true, "notes": true,
		"frequency": true, "interval": true, "start_date": true, "end_date": true, "active": true,
	},
	"obligations": {
		"side": true, "party": true, "title": true, "amount": true, "outstanding_amount": true,
		"source_transaction": true, "due_date": true, "notes": true, "status": true,
	},
	"settlements": {
		"obligation": true, "transaction": true, "amount": true, "date": true, "notes": true,
	},
}

type financeListInput struct {
	Account string `query:"account"`
}

type financeListOutput struct {
	Body []map[string]any
}

type financeUserContextKey struct{}

// registerFinanceAPI serves the documented list operations through Huma. The
// custom PocketBase routes below call the same list function so both surfaces
// keep the same filtering, ownership, and response behavior.
func registerFinanceAPI(app core.App, api huma.API) {
	for _, collection := range financeCollections {
		name := collection
		huma.Register(api, huma.Operation{
			OperationID: "listFinance" + strings.Title(name),
			Method:      http.MethodGet,
			Path:        "/api/finance/" + name,
			Tags:        []string{"Finance"},
			Summary:     "List the current user's " + name,
			Security:    []map[string][]string{{"pocketbaseAuth": {}}},
			Errors:      []int{http.StatusUnauthorized},
			Middlewares: huma.Middlewares{financeListAuthMiddleware(app, api)},
		}, func(ctx context.Context, input *financeListInput) (*financeListOutput, error) {
			user, ok := ctx.Value(financeUserContextKey{}).(*core.Record)
			if !ok || user == nil {
				return nil, huma.Error401Unauthorized("authentication required")
			}
			records, err := listFinanceData(app, name, user.Id, input.Account)
			if err != nil {
				return nil, err
			}
			return &financeListOutput{Body: records}, nil
		})
	}
}

func financeListAuthMiddleware(app core.App, api huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		scheme, token, ok := strings.Cut(strings.TrimSpace(ctx.Header("Authorization")), " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "authentication required")
			return
		}
		user, err := app.FindAuthRecordByToken(strings.TrimSpace(token), core.TokenTypeAuth)
		if err != nil {
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "authentication required")
			return
		}
		next(huma.WithValue(ctx, financeUserContextKey{}, user))
	}
}

func registerFinanceHooks(pb *pocketbase.PocketBase) {
	pb.OnRecordUpdateRequest("checkpoints").BindFunc(func(event *core.RecordRequestEvent) error {
		if event.HasSuperuserAuth() || checkpointConfirmationPresent(event.Request) {
			return event.Next()
		}
		return event.BadRequestError("checkpoints are immutable; pass confirm=... to change one", nil)
	})
	pb.OnRecordDeleteRequest("checkpoints").BindFunc(func(event *core.RecordRequestEvent) error {
		if event.HasSuperuserAuth() || checkpointConfirmationPresent(event.Request) {
			return event.Next()
		}
		return event.BadRequestError("checkpoints are immutable; pass confirm=... to delete one", nil)
	})
}

func checkpointConfirmationPresent(request *http.Request) bool {
	_, present := request.URL.Query()["confirm"]
	return present
}

func registerFinanceRoutes(e *core.ServeEvent, config Config) {
	// /api/finance is the documented path. The short paths keep the API easy to
	// use for clients that already use /api/{resource} custom endpoints.
	for _, prefix := range []string{"/api/finance", "/api"} {
		registerFinanceResourceRoutes(e, prefix, config)
		registerObligationRoutes(e, prefix)
		registerTransactionSplitRoutes(e, prefix)
		registerGoalContributionRoutes(e, prefix)
		registerRecurringGoalContributionRoutes(e, prefix)
		registerTransferRoutes(e, prefix)
		registerAssetValuationRoutes(e, prefix)
	}
}

func registerTransferRoutes(e *core.ServeEvent, prefix string) {
	e.Router.POST(prefix+"/transfers", createTransferRoute)
	e.Router.PATCH(prefix+"/transfers/{id}", updateTransferRoute)
	e.Router.PUT(prefix+"/transfers/{id}", updateTransferRoute)
}

func createTransferRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	fromID := stringValue(input["source_account"])
	toID := stringValue(input["destination_account"])
	amount, err := strconv.ParseFloat(fmt.Sprint(input["amount"]), 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return event.BadRequestError("amount must be greater than zero", nil)
	}
	date, err := transferDate(input["date"])
	if err != nil {
		return event.BadRequestError("date must use YYYY-MM-DD", nil)
	}
	var source, destination *core.Record
	err = event.App.RunInTransaction(func(tx core.App) error {
		from, err := ownedTransferAccount(tx, fromID, user.Id)
		if err != nil {
			return event.BadRequestError("source account not found", nil)
		}
		to, err := ownedTransferAccount(tx, toID, user.Id)
		if err != nil {
			return event.BadRequestError("destination account not found", nil)
		}
		if from.Id == to.Id {
			return event.BadRequestError("source and destination accounts must be different", nil)
		}
		collection, err := tx.FindCollectionByNameOrId("transactions")
		if err != nil {
			return err
		}
		source = core.NewRecord(collection)
		source.Set("owner", user.Id)
		source.Set("account", from.Id)
		source.Set("date", date)
		source.Set("amount", -amount)
		source.Set("type", "transfer")
		source.Set("payee", "Transfer to "+to.GetString("name"))
		source.Set("description", stringValue(input["notes"]))
		source.Set("notes", stringValue(input["notes"]))
		if err := validateTransactionWrite(tx, source, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		if err := tx.Save(source); err != nil {
			return err
		}
		source.Set("transfer_id", source.Id)
		if err := tx.Save(source); err != nil {
			return err
		}
		destination = core.NewRecord(collection)
		destination.Set("owner", user.Id)
		destination.Set("account", to.Id)
		destination.Set("date", date)
		destination.Set("amount", amount)
		destination.Set("type", "transfer")
		destination.Set("payee", "Transfer from "+from.GetString("name"))
		destination.Set("description", stringValue(input["notes"]))
		destination.Set("notes", stringValue(input["notes"]))
		destination.Set("transfer_id", source.Id)
		if err := validateTransactionWrite(tx, destination, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		return tx.Save(destination)
	})
	if err != nil {
		return err
	}
	if err := createAccountLowBalanceNotifications(event.App, user.Id); err != nil {
		event.App.Logger().Error("create low balance alert for transfer", "transfer_id", source.Id, "error", err)
	}
	logDomainMutation(event, user.Id, "create", "transactions", source.Id, map[string]any{"transfer_id": source.Id})
	logDomainMutation(event, user.Id, "create", "transactions", destination.Id, map[string]any{"transfer_id": source.Id})
	return event.JSON(http.StatusCreated, map[string]any{"transfer_id": source.Id, "source": source.PublicExport(), "destination": destination.PublicExport()})
}

func updateTransferRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	transferID := event.Request.PathValue("id")
	fromID := stringValue(input["source_account"])
	toID := stringValue(input["destination_account"])
	amount, err := strconv.ParseFloat(fmt.Sprint(input["amount"]), 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return event.BadRequestError("amount must be greater than zero", nil)
	}
	date, err := transferDate(input["date"])
	if err != nil {
		return event.BadRequestError("date must use YYYY-MM-DD", nil)
	}
	var source, destination *core.Record
	err = event.App.RunInTransaction(func(tx core.App) error {
		records, err := tx.FindRecordsByFilter("transactions", "owner = {:owner} && transfer_id = {:transfer}", "id", 2, 0, dbx.Params{"owner": user.Id, "transfer": transferID})
		if err != nil || len(records) != 2 {
			return event.NotFoundError("transfer not found", nil)
		}
		if records[0].GetFloat("amount") < 0 {
			source, destination = records[0], records[1]
		} else {
			source, destination = records[1], records[0]
		}
		from, err := ownedTransferAccount(tx, fromID, user.Id)
		if err != nil {
			return event.BadRequestError("source account not found", nil)
		}
		to, err := ownedTransferAccount(tx, toID, user.Id)
		if err != nil {
			return event.BadRequestError("destination account not found", nil)
		}
		if from.Id == to.Id {
			return event.BadRequestError("source and destination accounts must be different", nil)
		}
		source.Set("account", from.Id)
		source.Set("date", date)
		source.Set("amount", -amount)
		source.Set("payee", "Transfer to "+to.GetString("name"))
		source.Set("description", stringValue(input["notes"]))
		source.Set("notes", stringValue(input["notes"]))
		destination.Set("account", to.Id)
		destination.Set("date", date)
		destination.Set("amount", amount)
		destination.Set("payee", "Transfer from "+from.GetString("name"))
		destination.Set("description", stringValue(input["notes"]))
		destination.Set("notes", stringValue(input["notes"]))
		if err := validateTransactionWrite(tx, source, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		if err := validateTransactionWrite(tx, destination, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		if err := tx.Save(source); err != nil {
			return err
		}
		return tx.Save(destination)
	})
	if err != nil {
		return err
	}
	if err := createAccountLowBalanceNotifications(event.App, user.Id); err != nil {
		event.App.Logger().Error("update low balance alert for transfer", "transfer_id", transferID, "error", err)
	}
	logDomainMutation(event, user.Id, "update", "transactions", source.Id, map[string]any{"transfer_id": transferID})
	logDomainMutation(event, user.Id, "update", "transactions", destination.Id, map[string]any{"transfer_id": transferID})
	return event.JSON(http.StatusOK, map[string]any{"transfer_id": transferID, "source": source.PublicExport(), "destination": destination.PublicExport()})
}

func transferDate(value any) (time.Time, error) {
	if date := stringValue(value); date != "" {
		return time.Parse("2006-01-02", date)
	}
	return time.Now().UTC(), nil
}

func ownedTransferAccount(app core.App, id, owner string) (*core.Record, error) {
	account, err := app.FindRecordById("accounts", id)
	if err != nil || !ownership.IsOwner(account, "owner", owner) || account.GetBool("archived") {
		return nil, fmt.Errorf("account not found")
	}
	return account, nil
}

func registerGoalContributionRoutes(e *core.ServeEvent, prefix string) {
	path := prefix + "/goals/{id}/contributions"
	e.Router.GET(path, listGoalContributionsRoute)
	e.Router.POST(path, createGoalContributionRoute)
}

func listGoalContributionsRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	goal, err := event.App.FindRecordById("goals", event.Request.PathValue("id"))
	if err != nil || !ownership.IsOwner(goal, "owner", user.Id) {
		return event.NotFoundError("goal not found", nil)
	}
	records, err := event.App.FindRecordsByFilter(
		"goal_contributions",
		"owner = {:owner} && goal = {:goal}",
		"-date,-id",
		0,
		0,
		dbx.Params{"owner": user.Id, "goal": goal.Id},
	)
	if err != nil {
		return err
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, record.PublicExport())
	}
	return event.JSON(http.StatusOK, result)
}

func createGoalContributionRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	amount, err := strconv.ParseFloat(fmt.Sprint(input["amount"]), 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return event.BadRequestError("amount must be greater than zero", nil)
	}
	kind := stringValue(input["type"])
	if kind != "contribution" && kind != "withdrawal" {
		return event.BadRequestError("type must be contribution or withdrawal", nil)
	}
	date := time.Now().UTC()
	if value := stringValue(input["date"]); value != "" {
		parsed, err := time.Parse("2006-01-02", value)
		if err != nil {
			return event.BadRequestError("date must use YYYY-MM-DD", nil)
		}
		date = parsed
	}
	accountID := stringValue(input["account"])
	transactionID := stringValue(input["transaction"])
	goalID := event.Request.PathValue("id")
	var contribution map[string]any
	err = event.App.RunInTransaction(func(tx core.App) error {
		goal, err := tx.FindRecordById("goals", goalID)
		if err != nil || !ownership.IsOwner(goal, "owner", user.Id) {
			return event.NotFoundError("goal not found", nil)
		}
		if accountID != "" {
			account, err := tx.FindRecordById("accounts", accountID)
			if err != nil || !ownership.IsOwner(account, "owner", user.Id) {
				return event.BadRequestError("account must belong to the current user", nil)
			}
		}
		if transactionID != "" {
			transaction, err := tx.FindRecordById("transactions", transactionID)
			if err != nil || !ownership.IsOwner(transaction, "owner", user.Id) {
				return event.BadRequestError("transaction must belong to the current user", nil)
			}
			if accountID != "" && transaction.GetString("account") != accountID {
				return event.BadRequestError("transaction must use the selected account", nil)
			}
		}
		previous := goal.GetFloat("current_amount")
		current := previous
		if kind == "withdrawal" {
			if amount > current+0.000001 {
				return event.BadRequestError("withdrawal cannot exceed the saved goal amount", nil)
			}
			current -= amount
		} else {
			current += amount
		}
		collection, err := tx.FindCollectionByNameOrId("goal_contributions")
		if err != nil {
			return err
		}
		record := core.NewRecord(collection)
		record.Set("owner", user.Id)
		record.Set("goal", goal.Id)
		record.Set("date", date)
		record.Set("type", kind)
		record.Set("amount", amount)
		record.Set("account", accountID)
		record.Set("transaction", transactionID)
		record.Set("notes", stringValue(input["notes"]))
		if err := tx.Save(record); err != nil {
			return err
		}
		goal.Set("current_amount", current)
		if err := tx.Save(goal); err != nil {
			return err
		}
		if err := createGoalMilestoneNotifications(tx, user.Id, goal, previous, current); err != nil {
			return err
		}
		contribution = map[string]any{"contribution": record.PublicExport(), "goal_current": current}
		return nil
	})
	if err != nil {
		return err
	}
	return event.JSON(http.StatusCreated, contribution)
}

func registerFinanceResourceRoutes(e *core.ServeEvent, prefix string, config Config) {
	for _, collection := range financeCollections {
		name := collection
		path := prefix + "/" + name
		e.Router.GET(path, func(event *core.RequestEvent) error {
			return listFinanceRecords(event, name, config.Development)
		})
		e.Router.POST(path, func(event *core.RequestEvent) error {
			return createFinanceRecord(event, name)
		})
		e.Router.GET(path+"/{id}", func(event *core.RequestEvent) error {
			return getFinanceRecord(event, name)
		})
		e.Router.PATCH(path+"/{id}", func(event *core.RequestEvent) error {
			return updateFinanceRecord(event, name)
		})
		e.Router.PUT(path+"/{id}", func(event *core.RequestEvent) error {
			return updateFinanceRecord(event, name)
		})
		e.Router.DELETE(path+"/{id}", func(event *core.RequestEvent) error {
			return deleteFinanceRecord(event, name)
		})
	}

	e.Router.GET(prefix+"/accounts/{id}/summary", accountSummaryRoute)
	e.Router.POST(prefix+"/accounts/{id}/reconcile", reconcileAccountRoute)
}

func listFinanceRecords(event *core.RequestEvent, collection string, development bool) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	if development {
		if err := ensureDevSampleData(event.App, user.Id); err != nil {
			return err
		}
	}
	result, err := listFinanceData(event.App, collection, user.Id, event.Request.URL.Query().Get("account"))
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, result)
}

func listFinanceData(app core.App, collection, owner, accountFilter string) ([]map[string]any, error) {
	filter := "owner = {:owner}"
	params := dbx.Params{"owner": owner}
	if accountFilter != "" {
		switch collection {
		case "transactions", "checkpoints", "goals", "recurring_transactions":
			filter += " && account = {:account}"
			params["account"] = accountFilter
		}
	}

	records, err := app.FindRecordsByFilter(collection, filter, financeSort(collection), 0, 0, params)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		response, err := financeRecordResponse(app, collection, record, owner)
		if err != nil {
			return nil, err
		}
		result = append(result, response)
	}
	return result, nil
}

func getFinanceRecord(event *core.RequestEvent, collection string) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	record, err := ownedFinanceRecord(event, collection, user.Id)
	if err != nil {
		return err
	}
	response, err := financeRecordResponse(event.App, collection, record, user.Id)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, response)
}

func createFinanceRecord(event *core.RequestEvent, collection string) error {
	if collection == "obligations" {
		return createObligationRecord(event)
	}
	if collection == "settlements" {
		return event.BadRequestError("settlements are created through an obligation", nil)
	}
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	if collection == "transactions" && stringValue(input["type"]) == "transfer" {
		return event.BadRequestError("use the transfers endpoint to create a paired transfer", nil)
	}
	if err := validateFinanceLinks(event, collection, input, nil, user.Id); err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	definition, err := event.App.FindCollectionByNameOrId(collection)
	if err != nil {
		return err
	}
	record := core.NewRecord(definition)
	record.Set("owner", user.Id)
	applyFinanceInput(record, collection, input)
	if collection == "recurring_transactions" {
		if _, ok := input["interval"]; !ok {
			record.Set("interval", 1)
		}
		if _, ok := input["active"]; !ok {
			record.Set("active", true)
		}
		if _, ok := input["next_date"]; !ok {
			record.Set("next_date", record.Get("start_date"))
		}
		if err := validateRecurringTransaction(record); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	if collection == "transactions" {
		if err := validateTransactionWrite(event.App, record, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	if err := event.App.Save(record); err != nil {
		return err
	}
	if collection == "assets" {
		if err := saveAssetValuation(event.App, user.Id, record); err != nil {
			event.App.Logger().Error("save initial asset valuation", "asset_id", record.Id, "error", err)
		}
	}
	if collection == "transactions" {
		if err := createBudgetOverrunNotifications(event.App, user.Id, record); err != nil {
			event.App.Logger().Error("create budget alert", "transaction_id", record.Id, "error", err)
		}
	}
	if collection == "transactions" || collection == "accounts" {
		if err := createAccountLowBalanceNotifications(event.App, user.Id); err != nil {
			event.App.Logger().Error("create low balance alert", "record_id", record.Id, "error", err)
		}
	}
	logDomainMutation(event, user.Id, "create", collection, record.Id, nil)
	response, err := financeRecordResponse(event.App, collection, record, user.Id)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusCreated, response)
}

func updateFinanceRecord(event *core.RequestEvent, collection string) error {
	if collection == "obligations" || collection == "settlements" {
		return event.BadRequestError("debt history records cannot be edited", nil)
	}
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	if collection == "checkpoints" && !checkpointConfirmationPresent(event.Request) {
		return event.BadRequestError("checkpoints are immutable; pass confirm=... to change one", nil)
	}
	record, err := ownedFinanceRecord(event, collection, user.Id)
	if err != nil {
		return err
	}
	if collection == "transactions" && record.GetString("transfer_id") != "" {
		return event.BadRequestError("use the transfers endpoint to update both sides of a transfer", nil)
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	if err := validateFinanceLinks(event, collection, input, record, user.Id); err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	if collection == "transactions" {
		linked, err := event.App.FindRecordsByFilter(
			"obligations",
			"owner = {:owner} && source_transaction = {:transaction}",
			"id",
			1,
			0,
			dbx.Params{"owner": user.Id, "transaction": record.Id},
		)
		if err != nil {
			return err
		}
		settlements, err := event.App.FindRecordsByFilter(
			"settlements",
			"owner = {:owner} && transaction = {:transaction}",
			"id",
			1,
			0,
			dbx.Params{"owner": user.Id, "transaction": record.Id},
		)
		if err != nil {
			return err
		}
		if len(settlements) > 0 {
			return event.BadRequestError("repayment transactions linked to debt history cannot be edited", nil)
		}
		if len(linked) > 0 {
			if _, amountChanged := input["amount"]; amountChanged {
				return event.BadRequestError("amounts on transactions linked to an obligation cannot be changed", nil)
			}
			if _, typeChanged := input["type"]; typeChanged {
				return event.BadRequestError("types on transactions linked to an obligation cannot be changed", nil)
			}
			if _, accountChanged := input["account"]; accountChanged {
				return event.BadRequestError("accounts on transactions linked to an obligation cannot be changed", nil)
			}
		}
	}
	applyFinanceInput(record, collection, input)
	record.Set("owner", user.Id)
	if collection == "recurring_transactions" {
		if err := validateRecurringTransaction(record); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	if collection == "transactions" {
		if err := validateTransactionWrite(event.App, record, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	if err := event.App.Save(record); err != nil {
		return err
	}
	if collection == "assets" {
		if err := saveAssetValuation(event.App, user.Id, record); err != nil {
			event.App.Logger().Error("save asset valuation", "asset_id", record.Id, "error", err)
		}
	}
	if collection == "transactions" {
		if err := createBudgetOverrunNotifications(event.App, user.Id, record); err != nil {
			event.App.Logger().Error("update budget alert", "transaction_id", record.Id, "error", err)
		}
	}
	if collection == "transactions" || collection == "accounts" {
		if err := createAccountLowBalanceNotifications(event.App, user.Id); err != nil {
			event.App.Logger().Error("update low balance alert", "record_id", record.Id, "error", err)
		}
	}
	logDomainMutation(event, user.Id, "update", collection, record.Id, nil)
	response, err := financeRecordResponse(event.App, collection, record, user.Id)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, response)
}

func deleteFinanceRecord(event *core.RequestEvent, collection string) error {
	if collection == "settlements" {
		return event.BadRequestError("debt history records cannot be deleted", nil)
	}
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	if collection == "obligations" {
		obligation, err := ownedFinanceRecord(event, collection, user.Id)
		if err != nil {
			return err
		}
		settlements, err := event.App.FindRecordsByFilter(
			"settlements",
			"owner = {:owner} && obligation = {:obligation}",
			"id",
			1,
			0,
			dbx.Params{"owner": user.Id, "obligation": obligation.Id},
		)
		if err != nil {
			return err
		}
		if len(settlements) > 0 {
			return event.BadRequestError("obligations with settlement history cannot be deleted", nil)
		}
		err = event.App.RunInTransaction(func(tx core.App) error {
			if sourceID := obligation.GetString("source_transaction"); sourceID != "" {
				source, err := tx.FindRecordById("transactions", sourceID)
				if err != nil || source.GetString("owner") != user.Id {
					return fmt.Errorf("source transaction not found")
				}
				if obligation.GetString("side") == "receivable" {
					source.Set("budget_amount", math.Min(math.Abs(source.GetFloat("amount")), source.GetFloat("budget_amount")+obligation.GetFloat("amount")))
				} else {
					incomeAmount := math.Min(math.Abs(source.GetFloat("amount")), source.GetFloat("income_amount")+obligation.GetFloat("amount"))
					source.Set("income_amount", incomeAmount)
					if incomeAmount > 0.005 {
						source.Set("type", "income")
					}
				}
				if err := tx.Save(source); err != nil {
					return err
				}
			}
			return tx.Delete(obligation)
		})
		if err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		logDomainMutation(event, user.Id, "delete", "obligations", obligation.Id, nil)
		return event.NoContent(http.StatusNoContent)
	}
	if collection == "checkpoints" && !checkpointConfirmationPresent(event.Request) {
		return event.BadRequestError("checkpoints are immutable; pass confirm=... to delete one", nil)
	}
	record, err := ownedFinanceRecord(event, collection, user.Id)
	if err != nil {
		return err
	}
	if collection == "transactions" {
		for _, link := range []struct {
			collection string
			filter     string
			message    string
		}{
			{"obligations", "owner = {:owner} && source_transaction = {:transaction}", "transactions linked to an obligation cannot be deleted"},
			{"settlements", "owner = {:owner} && transaction = {:transaction}", "repayment transactions linked to debt history cannot be deleted"},
		} {
			linked, err := event.App.FindRecordsByFilter(
				link.collection,
				link.filter,
				"id",
				1,
				0,
				dbx.Params{"owner": user.Id, "transaction": record.Id},
			)
			if err != nil {
				return err
			}
			if len(linked) > 0 {
				return event.BadRequestError(link.message, nil)
			}
		}
	}
	if collection == "transactions" && record.GetString("transfer_id") != "" {
		transferID := record.GetString("transfer_id")
		records, err := event.App.FindRecordsByFilter(
			"transactions",
			"owner = {:owner} && transfer_id = {:transfer}",
			"id",
			2,
			0,
			dbx.Params{"owner": user.Id, "transfer": transferID},
		)
		if err != nil || len(records) != 2 {
			return event.BadRequestError("transfer pair is incomplete; refresh before deleting", err)
		}
		if err := event.App.RunInTransaction(func(tx core.App) error {
			for _, item := range records {
				if err := tx.Delete(item); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
		for _, item := range records {
			logDomainMutation(event, user.Id, "delete", collection, item.Id, map[string]any{"transfer_id": transferID})
		}
		return event.NoContent(http.StatusNoContent)
	}
	if err := event.App.Delete(record); err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "delete", collection, record.Id, nil)
	return event.NoContent(http.StatusNoContent)
}

func reconcileAccountRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	account, err := ownedFinanceRecord(event, "accounts", user.Id)
	if err != nil {
		return err
	}
	transactions, err := event.App.FindRecordsByFilter("transactions", "owner = {:owner} && account = {:account}", "date,id", 0, 0, dbx.Params{
		"owner": user.Id, "account": account.Id,
	})
	if err != nil {
		return err
	}
	checkpoints, err := event.App.FindRecordsByFilter("checkpoints", "owner = {:owner} && account = {:account}", "date", 0, 0, dbx.Params{
		"owner": user.Id, "account": account.Id,
	})
	if err != nil {
		return err
	}
	for _, window := range checkpointWindows(account, checkpoints, transactions) {
		amount := window["unexplained"].(float64)
		if moneyEqual(amount, 0) {
			continue
		}
		checkpointID, _ := window["toCheckpoint"].(string)
		checkpoint, err := event.App.FindRecordById("checkpoints", checkpointID)
		if err != nil || !ownership.IsOwner(checkpoint, "owner", user.Id) || checkpoint.GetString("account") != account.Id {
			return event.NotFoundError("checkpoint not found", nil)
		}
		definition, err := event.App.FindCollectionByNameOrId("transactions")
		if err != nil {
			return err
		}
		record := core.NewRecord(definition)
		record.Set("owner", user.Id)
		record.Set("account", account.Id)
		record.Set("date", checkpoint.Get("date"))
		record.Set("amount", amount)
		record.Set("type", "miscellaneous_reconciliation")
		record.Set("category", "Miscellaneous")
		record.Set("payee", "Miscellaneous reconciliation")
		record.Set("reconciled", true)
		record.Set("cleared", true)
		if err := event.App.Save(record); err != nil {
			return err
		}
		logDomainMutation(event, user.Id, "create", "transactions", record.Id, map[string]any{
			"account_id": account.Id, "checkpoint_id": checkpoint.Id, "source": "reconcile",
		})
		response, err := financeRecordResponse(event.App, "transactions", record, user.Id)
		if err != nil {
			return err
		}
		return event.JSON(http.StatusCreated, response)
	}
	return event.BadRequestError("no unexplained checkpoint gap to reconcile", nil)
}

func logDomainMutation(event *core.RequestEvent, actorID, action, resource, resourceID string, metadata map[string]any) {
	logger := audit.PocketBaseRecorder{App: event.App}
	if err := logger.Log(event.Request.Context(), audit.Event{
		ActorID: actorID, Action: action, Resource: resource, ResourceID: resourceID, Metadata: metadata,
	}); err != nil {
		event.App.Logger().Error("write audit event", "action", action, "collection", resource, "resource_id", resourceID, "error", err)
	}
}

func accountSummaryRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	account, err := ownedFinanceRecord(event, "accounts", user.Id)
	if err != nil {
		return err
	}
	summary, err := accountSummary(event.App, account, user.Id)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, summary)
}

func ownedFinanceRecord(event *core.RequestEvent, collection, owner string) (*core.Record, error) {
	record, err := event.App.FindRecordById(collection, event.Request.PathValue("id"))
	if err != nil || !ownership.IsOwner(record, "owner", owner) {
		return nil, event.NotFoundError(strings.TrimSuffix(collection, "s")+" not found", nil)
	}
	return record, nil
}

func financeInput(event *core.RequestEvent) (map[string]any, error) {
	input := map[string]any{}
	if err := event.BindBody(&input); err != nil {
		return nil, event.BadRequestError("invalid request body", err)
	}
	return input, nil
}

func applyFinanceInput(record *core.Record, collection string, input map[string]any) {
	for field, value := range input {
		if field == "account_id" {
			field = "account"
		}
		if financeFields[collection][field] {
			record.Set(field, value)
		}
	}
}

func validateFinanceLinks(event *core.RequestEvent, collection string, input map[string]any, existing *core.Record, owner string) error {
	accountID := ""
	if value, ok := input["account"]; ok {
		accountID = stringValue(value)
	} else if value, ok := input["account_id"]; ok {
		accountID = stringValue(value)
	} else if existing != nil {
		accountID = existing.GetString("account")
	}

	requiresAccount := collection == "transactions" || collection == "checkpoints" || collection == "recurring_transactions"
	if requiresAccount && accountID == "" {
		return fmt.Errorf("%s requires an account", collection)
	}
	if accountID == "" {
		return nil
	}
	account, err := event.App.FindRecordById("accounts", accountID)
	if err != nil || account.GetString("owner") != owner {
		return fmt.Errorf("account not found")
	}
	return nil
}

func validateTransactionWrite(app core.App, transaction *core.Record, owner string) error {
	account, err := app.FindRecordById("accounts", transaction.GetString("account"))
	if err != nil || account.GetString("owner") != owner {
		return fmt.Errorf("account not found")
	}
	return nil
}

func validateScheduledTransactionWrite(app core.App, transaction *core.Record, owner string) error {
	return validateTransactionWrite(app, transaction, owner)
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func financeSort(collection string) string {
	switch collection {
	case "accounts", "budgets", "goals":
		return "name"
	case "transactions", "checkpoints":
		return "-date"
	case "recurring_transactions":
		return "next_date"
	case "obligations":
		return "due_date,party,id"
	case "settlements":
		return "-date,id"
	case "assets":
		return "-as_of"
	default:
		return "-created"
	}
}

func financeRecordResponse(app core.App, collection string, record *core.Record, owner string) (map[string]any, error) {
	response := record.PublicExport()
	if collection == "accounts" {
		summary, err := accountSummary(app, record, owner)
		if err != nil {
			return nil, err
		}
		for key, value := range summary {
			if key != "id" && key != "collectionId" && key != "collectionName" {
				response[key] = value
			}
		}
	}
	return response, nil
}

func accountSummary(app core.App, account *core.Record, owner string) (map[string]any, error) {
	transactions, err := app.FindRecordsByFilter("transactions", "owner = {:owner} && account = {:account}", "date,id", 0, 0, dbx.Params{
		"owner": owner, "account": account.Id,
	})
	if err != nil {
		return nil, err
	}
	checkpoints, err := app.FindRecordsByFilter("checkpoints", "owner = {:owner} && account = {:account}", "date", 0, 0, dbx.Params{
		"owner": owner, "account": account.Id,
	})
	if err != nil {
		return nil, err
	}

	opening := account.GetFloat("opening_balance")
	balance := opening
	clearedBalance := opening
	reconciledBalance := opening
	transactionCount := 0
	for _, transaction := range transactions {
		if transaction.GetString("parent_transaction") != "" {
			continue
		}
		transactionCount++
		amount := transaction.GetFloat("amount")
		balance += amount
		if transaction.GetBool("cleared") || transaction.GetBool("reconciled") {
			clearedBalance += amount
		}
		if transaction.GetBool("reconciled") {
			reconciledBalance += amount
		}
	}

	windows := checkpointWindows(account, checkpoints, transactions)
	miscellaneousAmount := 0.0
	miscellaneousItems := make([]map[string]any, 0)
	for _, window := range windows {
		amount := window["unexplained"].(float64)
		if moneyEqual(amount, 0) {
			continue
		}
		miscellaneousAmount += amount
		miscellaneousItems = append(miscellaneousItems, map[string]any{
			"checkpoint": window["toCheckpoint"],
			"date":       window["toDate"],
			"amount":     amount,
		})
	}
	result := map[string]any{
		"balance":                  balance,
		"miscellaneous":            map[string]any{"name": "Miscellaneous", "amount": miscellaneousAmount, "items": miscellaneousItems},
		"clearedBalance":           clearedBalance,
		"reconciledBalance":        reconciledBalance,
		"transactionCount":         transactionCount,
		"lastCheckpoint":           nil,
		"reconciliationDifference": nil,
		"checkpointWindows":        windows,
	}
	if len(checkpoints) == 0 {
		return result, nil
	}

	latestCheckpoint := checkpoints[0]
	for _, checkpoint := range checkpoints[1:] {
		if checkpoint.GetDateTime("date").Time().After(latestCheckpoint.GetDateTime("date").Time()) {
			latestCheckpoint = checkpoint
		}
	}
	checkpointDate := latestCheckpoint.GetDateTime("date").Time()
	checkpointCalculated := opening
	for _, transaction := range transactions {
		if transaction.GetString("parent_transaction") != "" {
			continue
		}
		if !transaction.GetDateTime("date").Time().After(checkpointDate) {
			checkpointCalculated += transaction.GetFloat("amount")
		}
	}
	difference := latestCheckpoint.GetFloat("balance") - checkpointCalculated
	checkpoint := latestCheckpoint.PublicExport()
	checkpoint["calculatedBalance"] = checkpointCalculated
	checkpoint["reconciliationDifference"] = difference
	result["lastCheckpoint"] = checkpoint
	result["reconciliationDifference"] = difference
	return result, nil
}

func checkpointWindows(account *core.Record, checkpoints, transactions []*core.Record) []map[string]any {
	sort.SliceStable(checkpoints, func(i, j int) bool {
		return checkpoints[i].GetDateTime("date").Time().Before(checkpoints[j].GetDateTime("date").Time())
	})
	windows := make([]map[string]any, 0, len(checkpoints))
	previousDate := account.GetDateTime("opening_balance_date").Time()
	previousBalance := account.GetFloat("opening_balance")
	var previousID any

	for _, checkpoint := range checkpoints {
		currentDate := checkpoint.GetDateTime("date").Time()
		actualDelta := checkpoint.GetFloat("balance") - previousBalance
		transactionDelta := 0.0
		allTransactionsReconciled := true
		for _, transaction := range transactions {
			if transaction.GetString("parent_transaction") != "" {
				continue
			}
			transactionDate := transaction.GetDateTime("date").Time()
			if !transactionDate.After(previousDate) || transactionDate.After(currentDate) {
				continue
			}
			transactionDelta += transaction.GetFloat("amount")
			if !transaction.GetBool("reconciled") {
				allTransactionsReconciled = false
			}
		}

		unexplained := actualDelta - transactionDelta
		state := "reconciled"
		if !previousDate.IsZero() && !currentDate.After(previousDate) {
			state = "invalid"
		} else if !moneyEqual(actualDelta, transactionDelta) {
			state = "invalid"
		} else if !allTransactionsReconciled {
			state = "incomplete"
		}

		window := map[string]any{
			"fromCheckpoint":   previousID,
			"toCheckpoint":     checkpoint.Id,
			"fromBalance":      previousBalance,
			"toBalance":        checkpoint.GetFloat("balance"),
			"actualDelta":      actualDelta,
			"transactionDelta": transactionDelta,
			"unexplained":      unexplained,
			"state":            state,
		}
		if !previousDate.IsZero() {
			window["fromDate"] = previousDate
		}
		window["toDate"] = currentDate
		windows = append(windows, window)
		previousDate = currentDate
		previousBalance = checkpoint.GetFloat("balance")
		previousID = checkpoint.Id
	}
	return windows
}

func moneyEqual(left, right float64) bool {
	return math.Abs(left-right) < 0.000001
}
