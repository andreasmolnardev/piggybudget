package app

import (
	"bytes"
	"strings"
	"testing"
)

func TestPiggybudgetBackupEncryptionUsesSharedEnvelope(t *testing.T) {
	dataDir := t.TempDir()
	encoded, err := CreateBackupEncryptionKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if encoded == "" {
		t.Fatal("expected recovery key")
	}

	key, err := LoadBackupEncryptionKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"format":"piggybudget-backup-json","version":1}`)
	encrypted, err := EncryptBackupPayload(key, payload)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(encrypted, []byte("SLBK1")) {
		t.Fatalf("encrypted payload lacks shared SLBK1 header: %q", encrypted[:min(len(encrypted), 5)])
	}
	decrypted, err := DecryptBackupPayload(key, encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decrypted, payload) {
		t.Fatalf("round trip changed payload: got %q", decrypted)
	}
}

func TestPiggybudgetBackupEncryptionWrapsRecoveryGuidance(t *testing.T) {
	if _, err := LoadBackupEncryptionKey(t.TempDir()); err == nil || !strings.Contains(err.Error(), "restore it to the server data directory") {
		t.Fatalf("expected Piggybudget recovery guidance, got %v", err)
	}
}
