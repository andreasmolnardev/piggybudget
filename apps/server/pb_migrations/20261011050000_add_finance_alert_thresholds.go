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
		return app.EnsureNotificationCollections(txApp)
	}, func(core.App) error {
		// Thresholds and notification history are user data.
		return nil
	}, "20261011050000_add_finance_alert_thresholds.go")
}
