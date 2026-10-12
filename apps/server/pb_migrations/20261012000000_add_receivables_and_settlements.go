package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		if err := app.EnsureFinanceCollections(txApp); err != nil {
			return err
		}
		return app.MigrateLegacyReceivables(txApp)
	}, func(core.App) error {
		return nil
	}, "20261012000000_add_receivables_and_settlements.go")
}
