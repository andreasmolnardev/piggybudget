package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureCollections(txApp)
	}, func(txApp core.App) error {
		return nil
	}, "20260913000003_add_caldav_hrefs.go")
}
