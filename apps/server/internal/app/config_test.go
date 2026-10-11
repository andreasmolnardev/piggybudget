package app

import "testing"

func TestLoadConfigPrefersPiggybudgetEnvironment(t *testing.T) {
	t.Setenv("PIGGYBUDGET_STORAGE_PATH", "/new/pb_data")
	t.Setenv("SLOPSTACK_STORAGE_PATH", "/old/pb_data")
	t.Setenv("PIGGYBUDGET_BACKUP_ENABLED", "true")
	t.Setenv("SLOPSTACK_BACKUP_ENABLED", "false")

	config := LoadConfig()
	if config.StoragePath != "/new/pb_data" {
		t.Fatalf("storage path = %q, want Piggybudget value", config.StoragePath)
	}
	if !config.BackupEnabled {
		t.Fatal("backup enabled = false, want Piggybudget value")
	}
}

func TestLoadConfigAcceptsLegacySlopstackEnvironment(t *testing.T) {
	t.Setenv("PIGGYBUDGET_STORAGE_PATH", "")
	t.Setenv("SLOPSTACK_STORAGE_PATH", "/legacy/pb_data")
	t.Setenv("PIGGYBUDGET_REGISTRATION_ENABLED", "")
	t.Setenv("SLOPSTACK_REGISTRATION_ENABLED", "false")

	config := LoadConfig()
	if config.StoragePath != "/legacy/pb_data" {
		t.Fatalf("storage path = %q, want legacy value", config.StoragePath)
	}
	if config.RegistrationMode != RegistrationDisabled {
		t.Fatalf("registration mode = %q, want disabled from legacy value", config.RegistrationMode)
	}
}
