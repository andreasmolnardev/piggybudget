package app

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

const financeOwnerRule = "@request.auth.id = owner"

type financeCollectionDefinition struct {
	name    string
	fields  []core.Field
	indexes []financeIndex
}

type financeIndex struct {
	name    string
	columns string
	unique  bool
}

// EnsureFinanceCollections creates or repairs the finance collections without
// changing existing user data. It is also called from the core schema repair
// path so test and newly-created databases get the same schema.
func EnsureFinanceCollections(app core.App) error {
	definitions := []financeCollectionDefinition{
		{
			name: "accounts",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.TextField{Name: "type"},
				&core.TextField{Name: "currency"},
				&core.NumberField{Name: "opening_balance"},
				&core.NumberField{Name: "alert_below"},
				&core.DateField{Name: "opening_balance_date"},
				&core.TextField{Name: "notes"},
				&core.BoolField{Name: "archived"},
				&core.BoolField{Name: "is_default"},
			},
			indexes: []financeIndex{{"idx_accounts_owner", "owner", false}},
		},
		{
			name: "transactions",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "account", Required: true},
				&core.DateField{Name: "date", Required: true},
				&core.NumberField{Name: "amount"},
				&core.TextField{Name: "type"},
				&core.TextField{Name: "payee"},
				&core.TextField{Name: "description"},
				&core.TextField{Name: "category"},
				&core.TextField{Name: "budget"},
				&core.JSONField{Name: "tags"},
				&core.JSONField{Name: "attachments"},
				&core.TextField{Name: "receipt"},
				&core.TextField{Name: "asset"},
				&core.TextField{Name: "receivable"},
				&core.NumberField{Name: "budget_amount"},
				&core.NumberField{Name: "income_amount"},
				&core.TextField{Name: "notes"},
				&core.TextField{Name: "transfer_id"},
				&core.TextField{Name: "split_group"},
				&core.TextField{Name: "parent_transaction"},
				&core.TextField{Name: "recurring_rule"},
				&core.DateField{Name: "recurring_date"},
				&core.BoolField{Name: "cleared"},
				&core.BoolField{Name: "reconciled"},
			},
			indexes: []financeIndex{
				{"idx_transactions_owner_account_date", "owner, account, date", false},
				{"idx_transactions_owner_transfer", "owner, transfer_id", false},
				{"idx_transactions_owner_split_group", "owner, split_group", false},
			},
		},
		{
			name: "recurring_transactions",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "account", Required: true},
				&core.NumberField{Name: "amount", Required: true},
				&core.TextField{Name: "type", Required: true},
				&core.TextField{Name: "payee"},
				&core.TextField{Name: "description"},
				&core.TextField{Name: "category"},
				&core.TextField{Name: "budget"},
				&core.JSONField{Name: "tags"},
				&core.TextField{Name: "receivable"},
				&core.TextField{Name: "notes"},
				&core.TextField{Name: "frequency", Required: true},
				&core.NumberField{Name: "interval", Required: true, OnlyInt: true},
				&core.DateField{Name: "start_date", Required: true},
				&core.DateField{Name: "next_date", Required: true},
				&core.DateField{Name: "end_date"},
				&core.BoolField{Name: "active"},
			},
			indexes: []financeIndex{{"idx_recurring_transactions_owner_next", "owner, active, next_date", false}},
		},
		{
			name: "obligations",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "side", Required: true},
				&core.TextField{Name: "party", Required: true},
				&core.TextField{Name: "title", Required: true},
				&core.NumberField{Name: "amount", Required: true},
				&core.NumberField{Name: "outstanding_amount", Required: true},
				&core.TextField{Name: "source_transaction"},
				&core.DateField{Name: "due_date"},
				&core.TextField{Name: "notes"},
				&core.TextField{Name: "status", Required: true},
			},
			indexes: []financeIndex{{"idx_obligations_owner_status_due", "owner, status, due_date", false}},
		},
		{
			name: "settlements",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "obligation", Required: true},
				&core.TextField{Name: "transaction", Required: true},
				&core.NumberField{Name: "amount", Required: true},
				&core.DateField{Name: "date", Required: true},
				&core.TextField{Name: "notes"},
			},
			indexes: []financeIndex{{"idx_settlements_owner_obligation_date", "owner, obligation, date", false}},
		},
		{
			name: "checkpoints",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "account", Required: true},
				&core.DateField{Name: "date", Required: true},
				&core.NumberField{Name: "balance"},
				&core.TextField{Name: "note"},
			},
			indexes: []financeIndex{{"idx_checkpoints_owner_account_date", "owner, account, date", false}},
		},
		{
			name: "budgets",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.TextField{Name: "category"},
				&core.NumberField{Name: "amount"},
				&core.DateField{Name: "start_date"},
				&core.DateField{Name: "end_date"},
				&core.TextField{Name: "notes"},
				&core.BoolField{Name: "archived"},
			},
			indexes: []financeIndex{{"idx_budgets_owner_dates", "owner, start_date, end_date", false}},
		},
		{
			name: "assets",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.TextField{Name: "type"},
				&core.NumberField{Name: "value"},
				&core.NumberField{Name: "quantity"},
				&core.TextField{Name: "currency"},
				&core.DateField{Name: "purchase_date"},
				&core.NumberField{Name: "purchase_price"},
				&core.TextField{Name: "purchase_transaction"},
				&core.NumberField{Name: "target_sale_price"},
				&core.DateField{Name: "as_of"},
				&core.TextField{Name: "notes"},
				&core.TextField{Name: "status"},
				&core.BoolField{Name: "archived"},
			},
			indexes: []financeIndex{{"idx_assets_owner", "owner", false}},
		},
		{
			name: "goals",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.NumberField{Name: "target_amount"},
				&core.NumberField{Name: "current_amount"},
				&core.DateField{Name: "target_date"},
				&core.TextField{Name: "account"},
				&core.TextField{Name: "notes"},
				&core.BoolField{Name: "completed"},
				&core.BoolField{Name: "archived"},
				&core.TextField{Name: "status"},
			},
			indexes: []financeIndex{{"idx_goals_owner", "owner", false}},
		},
		{
			name: "goal_contributions",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "goal", Required: true},
				&core.DateField{Name: "date", Required: true},
				&core.TextField{Name: "type", Required: true},
				&core.NumberField{Name: "amount", Required: true},
				&core.TextField{Name: "account"},
				&core.TextField{Name: "transaction"},
				&core.TextField{Name: "notes"},
			},
			indexes: []financeIndex{{"idx_goal_contributions_owner_goal_date", "owner, goal, date", false}},
		},
		{
			name: "recurring_goal_contributions",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "goal", Required: true},
				&core.NumberField{Name: "amount", Required: true},
				&core.TextField{Name: "account"},
				&core.TextField{Name: "frequency", Required: true},
				&core.NumberField{Name: "interval", Required: true, OnlyInt: true},
				&core.DateField{Name: "start_date", Required: true},
				&core.DateField{Name: "next_date", Required: true},
				&core.DateField{Name: "end_date"},
				&core.TextField{Name: "notes"},
				&core.BoolField{Name: "active"},
			},
			indexes: []financeIndex{{"idx_recurring_goal_contributions_owner_next", "owner, active, next_date", false}},
		},
	}

	for _, definition := range definitions {
		collection, err := app.FindCollectionByNameOrId(definition.name)
		if err != nil {
			collection = core.NewBaseCollection(definition.name)
		}
		for _, field := range definition.fields {
			if collection.Fields.GetByName(field.GetName()) == nil {
				collection.Fields.Add(field)
			}
		}
		collection.ListRule = stringPointer(financeOwnerRule)
		collection.ViewRule = stringPointer(financeOwnerRule)
		collection.CreateRule = stringPointer(financeOwnerRule)
		collection.UpdateRule = stringPointer(financeOwnerRule)
		collection.DeleteRule = stringPointer(financeOwnerRule)
		for _, index := range definition.indexes {
			if collection.GetIndex(index.name) == "" {
				collection.AddIndex(index.name, index.unique, index.columns, "")
			}
		}
		if definition.name == "transactions" && collection.GetIndex("idx_transactions_recurring_occurrence") == "" {
			collection.AddIndex(
				"idx_transactions_recurring_occurrence",
				true,
				"owner, recurring_rule, recurring_date",
				"recurring_rule != ''",
			)
		}
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("save %s collection: %w", definition.name, err)
		}
	}
	return nil
}

func stringPointer(value string) *string {
	return &value
}
