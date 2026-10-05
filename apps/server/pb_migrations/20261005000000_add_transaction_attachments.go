package migrations

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/slopstack/slopstack/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return app.EnsureTransactionAttachmentCollection(txApp)
	}, func(core.App) error {
		// Attachments are user data; rollback must not delete them.
		return nil
	}, "20261005000000_add_transaction_attachments.go")
}
