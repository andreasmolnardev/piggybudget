package app

import (
	"crypto/rand"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/andreasmolnardev/slopstack/go/backup"
	"github.com/andreasmolnardev/slopstack/go/httpapi"
	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func Register(pb *pocketbase.PocketBase, config Config, api huma.API) error {
	registerFinanceAPI(pb, api)
	pb.RootCmd.PersistentFlags().StringVar(&config.HTTPAddress, "http", config.HTTPAddress, "HTTP address")
	pb.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := backup.CleanupRestoreArchives(e.App.DataDir(), "piggybudget_restore_", "slopstack_restore_"); err != nil {
			return fmt.Errorf("clean up temporary restore archives: %w", err)
		}
		if err := e.App.RunAppMigrations(); err != nil {
			return err
		}
		// Repair databases created by an older bootstrap path or a partially
		// applied migration after the migration registry has run.
		if err := EnsureCollections(e.App); err != nil {
			return err
		}
		if config.Development {
			if err := EnsureDevSampleSeedField(e.App); err != nil {
				return err
			}
		}
		if err := EnsureAssetGroupCollections(e.App); err != nil {
			return err
		}
		if err := EnsureAssetValuationCollection(e.App); err != nil {
			return err
		}
		if err := EnsureTransactionAttachmentCollection(e.App); err != nil {
			return err
		}
		if err := EnsureNotificationCollections(e.App); err != nil {
			return err
		}
		if err := EnsureCalDAVChanges(e.App); err != nil {
			return err
		}
		return applyBackupConfig(e.App, config)
	})
	protectUserAdminFlag(pb, config)
	if err := registerOwnershipHooks(pb); err != nil {
		return fmt.Errorf("register ownership request hooks: %w", err)
	}
	registerFinanceHooks(pb)
	if err := audit.RegisterRequestHooks(pb, audit.PocketBaseRecorder{App: pb}, audit.RequestHookConfig{
		Collections: []string{
			"accounts", "transactions", "checkpoints", "budgets", "assets", "goals",
			"asset_groups", "asset_positions", transactionAttachmentCollection,
		},
	}); err != nil {
		return fmt.Errorf("register audit request hooks: %w", err)
	}
	RegisterAssetGroupHooks(pb)
	RegisterTransactionAttachmentHooks(pb)
	registerCalDAVChangeHooks(pb)
	registerReminderScheduler(pb)
	registerRecurringTransactionScheduler(pb)
	registerRecurringGoalContributionScheduler(pb)
	registerFinanceReminderScheduler(pb)
	// Keep protocol fixtures available to the server's existing DAV tests. They
	// are not part of the Piggybudget product surface or web navigation.
	pb.OnRecordAfterCreateSuccess("users").BindFunc(func(e *core.RecordEvent) error {
		if err := provisionDefaultContainers(e.App, e.Record.Id); err != nil {
			return err
		}
		return e.Next()
	})

	pb.OnServe().BindFunc(func(e *core.ServeEvent) error {
		registerRoutes(e, config, api)
		return e.Next()
	})
	return nil
}

func applyBackupConfig(app core.App, config Config) error {
	settings := app.Settings()
	if config.PublicURL != "" {
		settings.Meta.AppURL = strings.TrimRight(config.PublicURL, "/")
	}
	if !config.BackupEnabled {
		settings.Backups.Cron = ""
		settings.Backups.S3.Enabled = false
		return nil
	}

	settings.Backups.Cron = config.BackupCron
	settings.Backups.CronMaxKeep = config.BackupMaxKeep
	settings.Backups.S3 = core.S3Config{
		Enabled:        config.BackupS3.Enabled,
		Bucket:         config.BackupS3.Bucket,
		Region:         config.BackupS3.Region,
		Endpoint:       config.BackupS3.Endpoint,
		AccessKey:      config.BackupS3.AccessKey,
		Secret:         config.BackupS3.Secret,
		ForcePathStyle: config.BackupS3.ForcePathStyle,
	}
	if err := settings.Backups.Validate(); err != nil {
		return fmt.Errorf("invalid backup configuration: %w", err)
	}
	return nil
}

func provisionDefaultContainers(app core.App, userID string) error {
	defaults := []struct {
		collection string
		name       string
		color      string
	}{
		{"lists", "Tasks", "#87c4a8"},
		{"calendars", "Events and Holidays", "#3b6ea8"},
		{"address_books", "Contacts", "#7657a8"},
	}

	for _, defaultContainer := range defaults {
		records, err := app.FindRecordsByFilter(
			defaultContainer.collection,
			"owner = {:owner} && name = {:name}",
			"",
			1,
			0,
			dbx.Params{"owner": userID, "name": defaultContainer.name},
		)
		if err != nil {
			return err
		}
		if len(records) > 0 {
			continue
		}

		collection, err := app.FindCollectionByNameOrId(defaultContainer.collection)
		if err != nil {
			return err
		}
		record := core.NewRecord(collection)
		record.Set("owner", userID)
		record.Set("name", defaultContainer.name)
		record.Set("color", defaultContainer.color)
		record.Set("is_default", true)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func activationCode() string {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "000000"
	}
	code := make([]byte, len(bytes))
	for index, value := range bytes {
		code[index] = '0' + value%10
	}
	return string(code)
}

func protectUserAdminFlag(pb *pocketbase.PocketBase, config Config) {
	pb.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if config.RegistrationMode == RegistrationDisabled {
			return e.ForbiddenError("registration is disabled", nil)
		}
		e.Record.Set("isAdmin", false)
		e.Record.Set("disabled", true)
		if config.RegistrationMode == RegistrationOTP {
			code := activationCode()
			e.Record.Set("activation_code", code)
			e.Record.Set("registration_status", "awaiting_activation")
		} else {
			e.Record.Set("registration_status", "awaiting_approval")
		}
		return e.Next()
	})
	pb.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			e.Record.Set("isAdmin", e.Record.Original().GetBool("isAdmin"))
		}
		return e.Next()
	})
}

func registerRoutes(e *core.ServeEvent, config Config, api huma.API) {
	httpapi.RegisterOpenAPIDocs(e, api)
	registerAuthRoutes(e, config)
	registerAppPasswordRoutes(e)
	registerCalendarIORoutes(e)
	registerOccurrenceRoutes(e)
	registerNotificationRoutes(e)
	registerCalDAVRoutes(e)
	registerCardDAVRoutes(e)
	registerSearchRoutes(e)
	registerFinanceRoutes(e, config)
	RegisterAssetGroupRoutes(e)
	RegisterTransactionAttachmentRoutes(e)
	publicDir := os.Getenv("PIGGYBUDGET_PUBLIC_DIR")
	if publicDir == "" {
		publicDir = "public"
	}
	httpapi.RegisterStaticDirectory(e, publicDir)
}

func registerAuthRoutes(e *core.ServeEvent, config Config) {
	e.Router.GET("/api/auth/registration-policy", func(event *core.RequestEvent) error {
		return event.JSON(http.StatusOK, map[string]string{"mode": string(config.RegistrationMode)})
	})
	if !config.Development {
		return
	}
	e.Router.POST("/api/auth/guest", func(event *core.RequestEvent) error {
		user, err := ensureGuestUser(event.App)
		if err != nil {
			return event.InternalServerError("could not create guest user", err)
		}
		token, err := user.NewAuthToken()
		if err != nil {
			return event.InternalServerError("could not create guest token", err)
		}
		return event.JSON(http.StatusOK, map[string]any{
			"token": token,
			"record": map[string]any{
				"id":             user.Id,
				"collectionId":   user.Collection().Id,
				"collectionName": user.Collection().Name,
				"email":          user.Email(),
				"verified":       user.Verified(),
				"display_name":   user.GetString("display_name"),
			},
		})
	})
}
