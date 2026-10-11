package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func createEncryptedArchive(ctx context.Context, pb core.App, key []byte, prefix string) (string, error) {
	plainName := prefix + ".zip"
	settings := pb.Settings()
	configuredS3 := settings.Backups.S3
	settings.Backups.S3.Enabled = false
	defer func() { settings.Backups.S3 = configuredS3 }()

	if err := pb.CreateBackup(ctx, plainName); err != nil {
		return "", err
	}
	localFS, err := pb.NewBackupsFilesystem()
	if err != nil {
		return "", err
	}
	localFS.SetContext(ctx)
	defer localFS.Close()
	defer localFS.Delete(plainName)

	reader, err := localFS.GetReader(plainName)
	if err != nil {
		return "", err
	}
	plain, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return "", readErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	encrypted, err := EncryptBackupPayload(key, plain)
	if err != nil {
		return "", err
	}

	settings.Backups.S3 = configuredS3
	remoteFS, err := pb.NewBackupsFilesystem()
	if err != nil {
		return "", err
	}
	defer remoteFS.Close()
	remoteFS.SetContext(ctx)
	name := prefix + ".zip.enc"
	if err := remoteFS.Upload(encrypted, name); err != nil {
		return "", err
	}
	return name, nil
}

func restoreEncryptedArchive(ctx context.Context, pb core.App, key []byte, name string) error {
	fsys, err := pb.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	fsys.SetContext(ctx)

	reader, err := fsys.GetReader(name)
	if err != nil {
		return err
	}
	ciphertext, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	plain, err := DecryptBackupPayload(key, ciphertext)
	if err != nil {
		return err
	}

	plainName := "piggybudget_restore_" + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
	settings := pb.Settings()
	configuredS3 := settings.Backups.S3
	settings.Backups.S3.Enabled = false
	defer func() { settings.Backups.S3 = configuredS3 }()
	localFS, err := pb.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer localFS.Close()
	localFS.SetContext(ctx)
	if err := localFS.Upload(plain, plainName); err != nil {
		return err
	}
	defer localFS.Delete(plainName)
	return pb.RestoreBackup(ctx, plainName)
}

func cleanupTransientBackupArchives(dataDir string) error {
	backupDir := filepath.Join(dataDir, core.LocalBackupsDirName)
	entries, err := os.ReadDir(backupDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && strings.HasPrefix(name, "piggybudget_restore_") && strings.HasSuffix(name, ".zip") {
			if err := os.Remove(filepath.Join(backupDir, name)); err != nil {
				return err
			}
		}
	}
	return nil
}
