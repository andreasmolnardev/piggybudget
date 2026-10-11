package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureFinanceCollections(txApp)
	}, func(core.App) error {
		// Contribution history is user data; rollback must not remove it.
		return nil
	}, "20261011020000_add_goal_contributions.go")
}
