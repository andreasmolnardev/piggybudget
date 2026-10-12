package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureFinanceCollections(txApp)
	}, func(core.App) error {
		return nil
	}, "20261012100000_add_parent_transactions.go")
}
