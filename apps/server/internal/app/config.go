package app

import (
	sharedconfig "github.com/andreasmolnardev/slopstack/go/config"
)

type RegistrationMode string

const (
	RegistrationDisabled RegistrationMode = "disabled"
	RegistrationApproval RegistrationMode = "approval"
	RegistrationOTP      RegistrationMode = "otp"
)

type Config struct {
	HTTPAddress      string
	PublicURL        string
	SecureCookies    bool
	RegistrationMode RegistrationMode
	LogLevel         string
	StoragePath      string
	Development      bool
	BackupEnabled    bool
	BackupCron       string
	BackupMaxKeep    int
	BackupS3         BackupS3Config
}

type BackupS3Config struct {
	Enabled        bool
	Bucket         string
	Region         string
	Endpoint       string
	AccessKey      string
	Secret         string
	ForcePathStyle bool
}

func LoadConfig() Config {
	return Config{
		HTTPAddress:      piggybudgetEnv("HTTP_ADDRESS", "0.0.0.0:8090"),
		PublicURL:        piggybudgetEnv("PUBLIC_URL", "http://localhost:8090"),
		SecureCookies:    piggybudgetEnvBool("SECURE_COOKIES", false),
		RegistrationMode: registrationMode(),
		LogLevel:         piggybudgetEnv("LOG_LEVEL", "info"),
		StoragePath:      piggybudgetEnv("STORAGE_PATH", "pb_data"),
		Development:      piggybudgetEnvBool("DEVELOPMENT", false),
		BackupEnabled:    piggybudgetEnvBool("BACKUP_ENABLED", false),
		BackupCron:       piggybudgetEnv("BACKUP_CRON", "0 3 * * *"),
		BackupMaxKeep:    piggybudgetEnvInt("BACKUP_MAX_KEEP", 14),
		BackupS3: BackupS3Config{
			Enabled:        piggybudgetEnvBool("BACKUP_S3_ENABLED", false),
			Bucket:         piggybudgetEnv("BACKUP_S3_BUCKET", ""),
			Region:         piggybudgetEnv("BACKUP_S3_REGION", ""),
			Endpoint:       piggybudgetEnv("BACKUP_S3_ENDPOINT", ""),
			AccessKey:      piggybudgetEnv("BACKUP_S3_ACCESS_KEY", ""),
			Secret:         piggybudgetEnv("BACKUP_S3_SECRET", ""),
			ForcePathStyle: piggybudgetEnvBool("BACKUP_S3_FORCE_PATH_STYLE", false),
		},
	}
}

func registrationMode() RegistrationMode {
	if !piggybudgetEnvBool("REGISTRATION_ENABLED", true) {
		return RegistrationDisabled
	}
	switch RegistrationMode(piggybudgetEnv("REGISTRATION_MODE", string(RegistrationApproval))) {
	case RegistrationDisabled, RegistrationOTP:
		return RegistrationMode(piggybudgetEnv("REGISTRATION_MODE", string(RegistrationApproval)))
	default:
		return RegistrationApproval
	}
}

// piggybudgetEnv prefers the current application prefix while retaining the
// Slopstack name as a compatibility alias for existing deployments.
func piggybudgetEnv(name, fallback string) string {
	return sharedconfig.Lookup("PIGGYBUDGET_"+name, "SLOPSTACK_"+name, fallback)
}

func piggybudgetEnvBool(name string, fallback bool) bool {
	return sharedconfig.Bool("PIGGYBUDGET_"+name, "SLOPSTACK_"+name, fallback)
}

func piggybudgetEnvInt(name string, fallback int) int {
	return sharedconfig.Int("PIGGYBUDGET_"+name, "SLOPSTACK_"+name, fallback)
}

func envCompat(primary, legacy, fallback string) string {
	return sharedconfig.Lookup(primary, legacy, fallback)
}

func envCompatLookup(primary, legacy string) (string, bool) {
	return sharedconfig.LookupValue(primary, legacy)
}
