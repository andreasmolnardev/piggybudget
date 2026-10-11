package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureAssetValuationCollection(txApp)
	}, func(core.App) error {
		// Valuation history is user data.
		return nil
	}, "20261011060000_add_asset_valuations.go")
}
