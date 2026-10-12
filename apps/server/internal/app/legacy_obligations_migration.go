package app

import (
	"math"
	"sort"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// MigrateLegacyReceivables converts name-linked money lent into one obligation
// per original expense and links existing repayments as settlement history.
func MigrateLegacyReceivables(app core.App) error {
	transactions, err := app.FindRecordsByFilter(
		"transactions",
		"receivable != ''",
		"owner,date,id",
		0,
		0,
		dbx.Params{},
	)
	if err != nil {
		return err
	}
	type group struct {
		owner      string
		party      string
		expenses   []*core.Record
		repayments []*core.Record
	}
	groups := map[string]*group{}
	for _, transaction := range transactions {
		party := strings.TrimSpace(transaction.GetString("receivable"))
		if party == "" {
			continue
		}
		key := transaction.GetString("owner") + "\x00" + strings.ToLower(party)
		item := groups[key]
		if item == nil {
			item = &group{owner: transaction.GetString("owner"), party: party}
			groups[key] = item
		}
		if transaction.GetFloat("amount") < 0 || transaction.GetString("type") == "expense" {
			item.expenses = append(item.expenses, transaction)
		} else if transaction.GetFloat("amount") > 0 {
			item.repayments = append(item.repayments, transaction)
		}
	}
	obligations, err := app.FindCollectionByNameOrId("obligations")
	if err != nil {
		return err
	}
	settlements, err := app.FindCollectionByNameOrId("settlements")
	if err != nil {
		return err
	}
	for _, item := range groups {
		if len(item.expenses) == 0 {
			continue
		}
		sort.Slice(item.expenses, func(i, j int) bool {
			return item.expenses[i].GetString("date") < item.expenses[j].GetString("date")
		})
		sort.Slice(item.repayments, func(i, j int) bool {
			return item.repayments[i].GetString("date") < item.repayments[j].GetString("date")
		})
		linked := make([]*core.Record, 0, len(item.expenses))
		for _, expense := range item.expenses {
			amount := math.Abs(expense.GetFloat("amount"))
			if amount <= 0 {
				continue
			}
			obligation := core.NewRecord(obligations)
			obligation.Set("owner", item.owner)
			obligation.Set("side", "receivable")
			obligation.Set("party", item.party)
			title := strings.TrimSpace(expense.GetString("payee"))
			if title == "" {
				title = "Money lent"
			}
			obligation.Set("title", title)
			obligation.Set("amount", amount)
			obligation.Set("outstanding_amount", amount)
			obligation.Set("source_transaction", expense.Id)
			obligation.Set("status", "open")
			if err := app.Save(obligation); err != nil {
				return err
			}
			expense.Set("budget_amount", 0)
			if err := app.Save(expense); err != nil {
				return err
			}
			linked = append(linked, obligation)
		}
		obligationIndex := 0
		for _, repayment := range item.repayments {
			remaining := repayment.GetFloat("amount")
			for remaining > 0.005 && obligationIndex < len(linked) {
				obligation := linked[obligationIndex]
				outstanding := obligation.GetFloat("outstanding_amount")
				if outstanding <= 0.005 {
					obligationIndex++
					continue
				}
				amount := math.Min(remaining, outstanding)
				settlement := core.NewRecord(settlements)
				settlement.Set("owner", item.owner)
				settlement.Set("obligation", obligation.Id)
				settlement.Set("transaction", repayment.Id)
				settlement.Set("amount", amount)
				settlement.Set("date", repayment.Get("date"))
				if err := app.Save(settlement); err != nil {
					return err
				}
				outstanding = math.Max(0, outstanding-amount)
				obligation.Set("outstanding_amount", outstanding)
				if outstanding <= 0.005 {
					obligation.Set("outstanding_amount", 0)
					obligation.Set("status", "settled")
					obligationIndex++
				}
				if err := app.Save(obligation); err != nil {
					return err
				}
				remaining -= amount
			}
			repayment.Set("type", "adjustment")
			repayment.Set("budget", "")
			repayment.Set("budget_amount", 0)
			repayment.Set("income_amount", 0)
			if err := app.Save(repayment); err != nil {
				return err
			}
		}
	}
	return nil
}
