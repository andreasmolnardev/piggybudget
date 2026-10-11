package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureFinanceCollections(txApp)
	}, func(core.App) error {
		// Goal status fields are user data; rollback must not remove them.
		return nil
	}, "20261011010000_add_goal_status.go")
}
