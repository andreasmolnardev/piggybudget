package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureAssetGroupCollections(txApp)
	}, func(core.App) error {
		// Asset groups and positions contain user data; rollback must not remove it.
		return nil
	}, "20261005000001_add_asset_groups_and_positions.go")
}
