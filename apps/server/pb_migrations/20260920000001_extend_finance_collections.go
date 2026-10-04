package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/slopstack/slopstack/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureFinanceCollections(txApp)
	}, func(core.App) error {
		// Finance fields are user data; rollback must not destroy them.
		return nil
	}, "20260920000001_extend_finance_collections.go")
}
