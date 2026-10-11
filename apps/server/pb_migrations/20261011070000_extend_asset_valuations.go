package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureAssetValuationCollection(txApp)
	}, func(core.App) error {
		// Historical snapshots must stay available after rollback.
		return nil
	}, "20261011070000_extend_asset_valuations.go")
}
