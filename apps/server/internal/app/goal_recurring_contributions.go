package app

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func registerRecurringGoalContributionRoutes(event *core.ServeEvent, prefix string) {
	path := prefix + "/goals/{id}/recurring-contributions"
	event.Router.GET(path, listRecurringGoalContributionsRoute)
	event.Router.POST(path, createRecurringGoalContributionRoute)
	event.Router.PATCH(prefix+"/recurring-goal-contributions/{id}", updateRecurringGoalContributionRoute)
	event.Router.DELETE(prefix+"/recurring-goal-contributions/{id}", deleteRecurringGoalContributionRoute)
}

func listRecurringGoalContributionsRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	goal, err := ownedRecurringGoal(event.App, event.Request.PathValue("id"), user.Id)
	if err != nil {
		return event.NotFoundError("goal not found", nil)
	}
	records, err := event.App.FindRecordsByFilter(
		"recurring_goal_contributions",
		"owner = {:owner} && goal = {:goal}",
		"next_date,id",
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

func createRecurringGoalContributionRoute(event *core.RequestEvent) error {
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
	frequency := stringValue(input["frequency"])
	interval := 1
	if value := stringValue(input["interval"]); value != "" {
		interval, err = strconv.Atoi(value)
		if err != nil {
			return event.BadRequestError("interval must be a whole number", nil)
		}
	}
	if !validRecurringFrequency(frequency) || interval < 1 || interval > 365 {
		return event.BadRequestError("frequency or interval is invalid", nil)
	}
	start, err := time.Parse("2006-01-02", stringValue(input["start_date"]))
	if err != nil {
		return event.BadRequestError("start date must use YYYY-MM-DD", nil)
	}
	end := time.Time{}
	if value := stringValue(input["end_date"]); value != "" {
		end, err = time.Parse("2006-01-02", value)
		if err != nil || end.Before(start) {
			return event.BadRequestError("end date must be on or after start date", nil)
		}
	}
	goal, err := ownedRecurringGoal(event.App, event.Request.PathValue("id"), user.Id)
	if err != nil || goal.GetBool("archived") || goal.GetString("status") == "paused" || goal.GetBool("completed") {
		return event.BadRequestError("goal must be active", nil)
	}
	accountID := stringValue(input["account"])
	if accountID != "" {
		account, err := event.App.FindRecordById("accounts", accountID)
		if err != nil || !ownership.IsOwner(account, "owner", user.Id) || account.GetBool("archived") {
			return event.BadRequestError("account must be active and belong to the current user", nil)
		}
	}
	collection, err := event.App.FindCollectionByNameOrId("recurring_goal_contributions")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("owner", user.Id)
	record.Set("goal", goal.Id)
	record.Set("amount", amount)
	record.Set("account", accountID)
	record.Set("frequency", frequency)
	record.Set("interval", interval)
	record.Set("start_date", start)
	record.Set("next_date", start)
	if !end.IsZero() {
		record.Set("end_date", end)
	}
	record.Set("notes", stringValue(input["notes"]))
	record.Set("active", true)
	if err := event.App.Save(record); err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "create", "recurring_goal_contributions", record.Id, map[string]any{"goal_id": goal.Id})
	return event.JSON(http.StatusCreated, record.PublicExport())
}

func updateRecurringGoalContributionRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	record, err := ownedRecurringGoalContribution(event.App, event.Request.PathValue("id"), user.Id)
	if err != nil {
		return event.NotFoundError("recurring goal contribution not found", nil)
	}
	input, err := financeInput(event)
	if err != nil {
		return err
	}
	active, ok := input["active"].(bool)
	if !ok {
		return event.BadRequestError("active must be true or false", nil)
	}
	if active {
		goal, err := ownedRecurringGoal(event.App, record.GetString("goal"), user.Id)
		if err != nil || goal.GetBool("archived") || goal.GetBool("completed") ||
			goal.GetString("status") == "paused" || goal.GetString("status") == "completed" {
			return event.BadRequestError("goal must be active before resuming its schedule", nil)
		}
	}
	record.Set("active", active)
	if err := event.App.Save(record); err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "update", "recurring_goal_contributions", record.Id, map[string]any{"active": active})
	return event.JSON(http.StatusOK, record.PublicExport())
}

func deleteRecurringGoalContributionRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	record, err := ownedRecurringGoalContribution(event.App, event.Request.PathValue("id"), user.Id)
	if err != nil {
		return event.NotFoundError("recurring goal contribution not found", nil)
	}
	if err := event.App.Delete(record); err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "delete", "recurring_goal_contributions", record.Id, nil)
	return event.NoContent(http.StatusNoContent)
}

func ownedRecurringGoal(app core.App, id, owner string) (*core.Record, error) {
	goal, err := app.FindRecordById("goals", id)
	if err != nil || !ownership.IsOwner(goal, "owner", owner) {
		return nil, fmt.Errorf("goal not found")
	}
	return goal, nil
}

func ownedRecurringGoalContribution(app core.App, id, owner string) (*core.Record, error) {
	record, err := app.FindRecordById("recurring_goal_contributions", id)
	if err != nil || !ownership.IsOwner(record, "owner", owner) {
		return nil, fmt.Errorf("recurring goal contribution not found")
	}
	return record, nil
}

func validRecurringFrequency(value string) bool {
	switch value {
	case "daily", "weekly", "monthly", "yearly":
		return true
	default:
		return false
	}
}

func runDueRecurringGoalContributions(app core.App, now time.Time) (int, error) {
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 23, 59, 59, 0, time.UTC)
	rules, err := app.FindRecordsByFilter(
		"recurring_goal_contributions",
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
		count, err := runRecurringGoalContribution(app, candidate.Id, today)
		created += count
		if err != nil {
			return created, err
		}
	}
	return created, nil
}

func registerRecurringGoalContributionScheduler(app core.App) {
	app.Cron().MustAdd("recurring-goal-contributions", "* * * * *", func() {
		if _, err := runDueRecurringGoalContributions(app, time.Now()); err != nil {
			app.Logger().Error("run recurring goal contributions", "error", err)
		}
	})
}

func runRecurringGoalContribution(app core.App, ruleID string, today time.Time) (int, error) {
	created := 0
	err := app.RunInTransaction(func(tx core.App) error {
		rule, err := tx.FindRecordById("recurring_goal_contributions", ruleID)
		if err != nil || !rule.GetBool("active") {
			return nil
		}
		goal, err := ownedRecurringGoal(tx, rule.GetString("goal"), rule.GetString("owner"))
		if err != nil || goal.GetBool("archived") || goal.GetBool("completed") ||
			goal.GetString("status") == "paused" || goal.GetString("status") == "completed" {
			rule.Set("active", false)
			return tx.Save(rule)
		}
		accountID := rule.GetString("account")
		if accountID != "" {
			account, err := tx.FindRecordById("accounts", accountID)
			if err != nil || !ownership.IsOwner(account, "owner", rule.GetString("owner")) || account.GetBool("archived") {
				rule.Set("active", false)
				return tx.Save(rule)
			}
		}
		contributions, err := tx.FindCollectionByNameOrId("goal_contributions")
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
			previous := goal.GetFloat("current_amount")
			current := previous + rule.GetFloat("amount")
			contribution := core.NewRecord(contributions)
			contribution.Set("owner", rule.GetString("owner"))
			contribution.Set("goal", goal.Id)
			contribution.Set("date", due)
			contribution.Set("type", "contribution")
			contribution.Set("amount", rule.GetFloat("amount"))
			contribution.Set("account", accountID)
			contribution.Set("notes", rule.GetString("notes"))
			if err := tx.Save(contribution); err != nil {
				return err
			}
			goal.Set("current_amount", current)
			if current >= goal.GetFloat("target_amount") {
				goal.Set("completed", true)
				goal.Set("status", "completed")
			}
			if err := tx.Save(goal); err != nil {
				return err
			}
			if err := createGoalMilestoneNotifications(tx, rule.GetString("owner"), goal, previous, current); err != nil {
				return err
			}
			if err := (audit.PocketBaseRecorder{App: tx}).Log(context.Background(), audit.Event{
				ActorID: rule.GetString("owner"), Action: "create", Resource: "goal_contributions", ResourceID: contribution.Id,
				Metadata: map[string]any{"source": "recurring_goal_contribution", "rule_id": rule.Id},
			}); err != nil {
				tx.Logger().Error("write recurring goal contribution audit event", "contribution_id", contribution.Id, "error", err)
			}
			created++
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
			if goal.GetBool("completed") {
				rule.Set("active", false)
				break
			}
		}
		return tx.Save(rule)
	})
	return created, err
}
