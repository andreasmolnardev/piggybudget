package app

import (
	"fmt"

	"github.com/andreasmolnardev/slopstack/go/backup"
)

// CreateBackupEncryptionKey creates Piggybudget's backup encryption key in the
// app's data directory. The key can be used by future encrypted export flows.
func CreateBackupEncryptionKey(dataDir string) (string, error) {
	key, err := backup.CreateKey(dataDir)
	if err != nil {
		return "", fmt.Errorf("create Piggybudget backup encryption key: %w", err)
	}
	return key, nil
}

// ImportBackupEncryptionKey stores a recovery key in the app's data directory.
func ImportBackupEncryptionKey(dataDir, encoded string) error {
	if err := backup.ImportKey(dataDir, encoded); err != nil {
		return fmt.Errorf("import Piggybudget backup encryption key: %w", err)
	}
	return nil
}

// LoadBackupEncryptionKey reads the app's stored backup key.
func LoadBackupEncryptionKey(dataDir string) ([]byte, error) {
	key, err := backup.LoadKey(dataDir)
	if err != nil {
		return nil, fmt.Errorf("load Piggybudget backup encryption key (restore it to the server data directory): %w", err)
	}
	return key, nil
}

// EncryptBackupPayload uses the shared SLBK1 envelope while leaving PocketBase
// archive and JSON encoding to Piggybudget.
func EncryptBackupPayload(key, payload []byte) ([]byte, error) {
	encrypted, err := backup.Encrypt(key, payload)
	if err != nil {
		return nil, fmt.Errorf("encrypt Piggybudget backup payload (check the backup key): %w", err)
	}
	return encrypted, nil
}

// DecryptBackupPayload opens a shared SLBK1 envelope and leaves archive and
// JSON decoding to Piggybudget.
func DecryptBackupPayload(key, encrypted []byte) ([]byte, error) {
	payload, err := backup.Decrypt(key, encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypt Piggybudget backup payload (check the backup key and file integrity): %w", err)
	}
	return payload, nil
}
