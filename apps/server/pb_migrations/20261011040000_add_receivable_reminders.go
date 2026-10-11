package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/piggybudget/piggybudget/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureNotificationCollections(txApp)
	}, func(core.App) error {
		// Reminder schedules and notification history are user data.
		return nil
	}, "20261011040000_add_receivable_reminders.go")
}
