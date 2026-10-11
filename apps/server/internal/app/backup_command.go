package app

import (
	"github.com/andreasmolnardev/slopstack/go/backup"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

const backupRestoreRestartedEnv = "PIGGYBUDGET_BACKUP_RESTORE_RESTARTED"
const legacyBackupRestoreRestartedEnv = "SLOPSTACK_BACKUP_RESTORE_RESTARTED"

// NewBackupCommand builds Piggybudget's backup CLI from the shared runtime,
// keeping the established command syntax and restore restart guard.
func NewBackupCommand(pb core.App) *cobra.Command {
	return newBackupCommand(pb.DataDir(), backup.PocketBaseStore{App: pb})
}

func newBackupCommand(dataDir string, store backup.Store) *cobra.Command {
	return backup.NewCommandWithOptions(backup.CommandOptions{
		DataDir:               dataDir,
		Store:                 store,
		KeyImportMode:         backup.KeyImportArgument,
		KeyInitMessage:        "Store this recovery key somewhere safe; it cannot be shown again:",
		KeyImportMessage:      "",
		RestartGuardEnv:       backupRestoreRestartedEnv,
		LegacyRestartGuardEnv: legacyBackupRestoreRestartedEnv,
		CreateTempPrefix:      "piggybudget_backup_",
		RestoreTempPrefix:     "piggybudget_restore_",
	})
}
