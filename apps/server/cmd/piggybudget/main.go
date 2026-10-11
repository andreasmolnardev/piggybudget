package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/piggybudget/piggybudget/apps/server/internal/app"
	_ "github.com/piggybudget/piggybudget/apps/server/pb_migrations"
	"github.com/pocketbase/pocketbase"
)

func main() {
	config := app.LoadConfig()
	if err := configureLogger(config.LogLevel, config.Development); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	pb := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: config.StoragePath, DefaultDev: config.Development})
	pb.RootCmd.Use = "piggybudget"
	pb.RootCmd.Short = "Piggybudget application server"
	if flag := pb.RootCmd.PersistentFlags().Lookup("http"); flag != nil {
		flag.DefValue = config.HTTPAddress
		_ = pb.RootCmd.PersistentFlags().Set("http", config.HTTPAddress)
	}

	api := newOpenAPI(config)
	app.Register(pb, config, api)
	registerExportCommand(pb, api)
	pb.RootCmd.AddCommand(app.NewBackupCommand(pb))

	if err := pb.Start(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func configureLogger(configuredLevel string, development bool) error {
	var level slog.Level
	switch strings.ToLower(strings.TrimSpace(configuredLevel)) {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		return fmt.Errorf("invalid PIGGYBUDGET_LOG_LEVEL %q (use debug, info, warn, or error)", configuredLevel)
	}
	options := &slog.HandlerOptions{Level: level}
	var handler slog.Handler = slog.NewJSONHandler(os.Stdout, options)
	if development {
		handler = slog.NewTextHandler(os.Stdout, options)
	}
	slog.SetDefault(slog.New(handler))
	return nil
}

func newOpenAPI(config app.Config) huma.API {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Piggybudget API", "0.1.0"))
	api.OpenAPI().OpenAPI = "3.1.0"
	api.OpenAPI().Servers = []*huma.Server{{URL: config.PublicURL}}
	api.OpenAPI().Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"pocketbaseAuth": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
	}
	return api
}

func registerExportCommand(pb *pocketbase.PocketBase, api huma.API) {
	pb.RootCmd.AddCommand((&app.OpenAPIExportCommand{Run: func() error {
		data, err := json.MarshalIndent(api.OpenAPI(), "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll("openapi", 0o755); err != nil {
			return err
		}
		path := filepath.Join("openapi", "openapi.json")
		if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
			return err
		}
		fmt.Println(path)
		return nil
	}}).Command())
}
