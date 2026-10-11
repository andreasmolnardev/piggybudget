package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/andreasmolnardev/slopstack/go/backup"
	"github.com/spf13/cobra"
)

type backupCommandStore struct {
	archives     map[string][]byte
	created      []string
	createLocal  []bool
	written      []string
	restored     string
	restoreLocal bool
}

func (s *backupCommandStore) Create(_ context.Context, name string, local bool) error {
	if s.archives == nil {
		s.archives = make(map[string][]byte)
	}
	s.created = append(s.created, name)
	s.createLocal = append(s.createLocal, local)
	s.archives[name] = []byte("zip archive")
	return nil
}

func (s *backupCommandStore) List(context.Context) ([]backup.Archive, error) {
	return []backup.Archive{{Name: "safe.zip", Size: 42, Modified: time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)}}, nil
}

func (s *backupCommandStore) Read(_ context.Context, name string, _ bool) ([]byte, error) {
	data, ok := s.archives[name]
	if !ok {
		return nil, fmt.Errorf("missing archive %q", name)
	}
	return append([]byte(nil), data...), nil
}

func (s *backupCommandStore) Write(_ context.Context, name string, data []byte, _ bool) error {
	if s.archives == nil {
		s.archives = make(map[string][]byte)
	}
	s.archives[name] = append([]byte(nil), data...)
	s.written = append(s.written, name)
	return nil
}

func (s *backupCommandStore) Delete(_ context.Context, name string, _ bool) error {
	delete(s.archives, name)
	return nil
}

func (s *backupCommandStore) Restore(_ context.Context, name string, local bool) error {
	s.restored = name
	s.restoreLocal = local
	return nil
}

func executePiggybudgetBackupCommand(t *testing.T, command *cobra.Command, args ...string) (string, error) {
	t.Helper()
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetErr(io.Discard)
	command.SetIn(strings.NewReader(""))
	command.SetArgs(args)
	err := command.Execute()
	return output.String(), err
}

func TestPiggybudgetBackupCreateDefaultsToPlainArchive(t *testing.T) {
	store := &backupCommandStore{}
	output, err := executePiggybudgetBackupCommand(t, newBackupCommand(t.TempDir(), store), "create")
	if err != nil {
		t.Fatal(err)
	}
	name := strings.TrimSpace(output)
	if !strings.HasPrefix(name, "manual_") || !strings.HasSuffix(name, ".zip") || strings.HasSuffix(name, ".zip.enc") {
		t.Fatalf("created archive name = %q, want manual_*.zip", name)
	}
	if len(store.created) != 1 || store.createLocal[0] {
		t.Fatalf("create calls = %v, local = %v; want one configured-store create", store.created, store.createLocal)
	}
}

func TestPiggybudgetBackupCreateCanEncryptAndCleansTemporaryArchive(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := backup.CreateKey(dataDir); err != nil {
		t.Fatal(err)
	}
	store := &backupCommandStore{}
	output, err := executePiggybudgetBackupCommand(t, newBackupCommand(dataDir, store), "create", "--encrypt")
	if err != nil {
		t.Fatal(err)
	}
	name := strings.TrimSpace(output)
	if !strings.HasPrefix(name, "manual_") || !strings.HasSuffix(name, ".zip.enc") {
		t.Fatalf("created archive name = %q, want manual_*.zip.enc", name)
	}
	if len(store.created) != 1 || !store.createLocal[0] || !strings.HasPrefix(store.created[0], "piggybudget_backup_") {
		t.Fatalf("temporary create calls = %v, local = %v", store.created, store.createLocal)
	}
	if _, exists := store.archives[store.created[0]]; exists {
		t.Fatalf("temporary plaintext archive %q remains", store.created[0])
	}
	if len(store.written) != 1 || store.written[0] != name {
		t.Fatalf("stored encrypted archives = %v, want %q", store.written, name)
	}
}

func TestPiggybudgetBackupKeyInitKeepsExistingGuidance(t *testing.T) {
	output, err := executePiggybudgetBackupCommand(t, newBackupCommand(t.TempDir(), &backupCommandStore{}), "key-init")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(output, "Store this recovery key somewhere safe; it cannot be shown again:\n") {
		t.Fatalf("key-init output lost Piggybudget guidance: %q", output)
	}
	if len(strings.Fields(output)) < 3 {
		t.Fatalf("key-init did not print a recovery key: %q", output)
	}
}

func TestPiggybudgetBackupKeyImportKeepsPositionalArgument(t *testing.T) {
	dataDir := t.TempDir()
	key, err := backup.CreateKey(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	output, err := executePiggybudgetBackupCommand(t, newBackupCommand(dataDir, &backupCommandStore{}), "key-import", key)
	if err != nil {
		t.Fatal(err)
	}
	if output != "" {
		t.Fatalf("key-import unexpectedly printed output: %q", output)
	}
	if _, err := backup.LoadKey(dataDir); err != nil {
		t.Fatalf("positional key was not installed: %v", err)
	}
}

func TestPiggybudgetBackupRestoreRequiresConfirmationAndSafeName(t *testing.T) {
	store := &backupCommandStore{archives: map[string][]byte{}}
	command := newBackupCommand(t.TempDir(), store)
	if _, err := executePiggybudgetBackupCommand(t, command, "restore", "safe.zip"); err == nil || !strings.Contains(err.Error(), "--confirm") {
		t.Fatalf("restore without confirmation error = %v", err)
	}
	command = newBackupCommand(t.TempDir(), store)
	if _, err := executePiggybudgetBackupCommand(t, command, "restore", "../unsafe.zip", "--confirm"); err == nil || !strings.Contains(err.Error(), "unsafe backup name") {
		t.Fatalf("unsafe restore name error = %v", err)
	}
	if store.restored != "" {
		t.Fatalf("restore ran unexpectedly for %q", store.restored)
	}
}

func TestPiggybudgetBackupRestoreHonorsCurrentAndLegacyRestartGuards(t *testing.T) {
	for _, test := range []struct {
		name    string
		primary string
		legacy  string
	}{
		{name: "current", primary: "1"},
		{name: "legacy fallback", primary: "", legacy: "1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(backupRestoreRestartedEnv, test.primary)
			t.Setenv(legacyBackupRestoreRestartedEnv, test.legacy)
			store := &backupCommandStore{}
			_, err := executePiggybudgetBackupCommand(t, newBackupCommand(t.TempDir(), store), "restore", "safe.zip", "--confirm")
			if err != nil {
				t.Fatal(err)
			}
			if store.restored != "" {
				t.Fatalf("restore ran after restart guard: %q", store.restored)
			}
		})
	}
}

func TestPiggybudgetBackupRestoreUsesConfiguredStore(t *testing.T) {
	store := &backupCommandStore{}
	_, err := executePiggybudgetBackupCommand(t, newBackupCommand(t.TempDir(), store), "restore", "safe.zip", "--confirm")
	if err != nil {
		t.Fatal(err)
	}
	if store.restored != "safe.zip" || store.restoreLocal {
		t.Fatalf("restore used name %q, local = %t; want configured-store restore", store.restored, store.restoreLocal)
	}
}

func TestPiggybudgetBackupListPrintsArchiveMetadata(t *testing.T) {
	output, err := executePiggybudgetBackupCommand(t, newBackupCommand(t.TempDir(), &backupCommandStore{}), "list")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"NAME", "safe.zip", "42", "2026-09-13T12:00:00Z"} {
		if !strings.Contains(output, expected) {
			t.Fatalf("backup list output %q does not contain %q", output, expected)
		}
	}
}
