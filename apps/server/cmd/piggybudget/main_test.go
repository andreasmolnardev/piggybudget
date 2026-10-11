package main

import "testing"

func TestConfigureLoggerAcceptsSupportedLevels(t *testing.T) {
	for _, level := range []string{"debug", "info", "warn", "warning", "error"} {
		t.Run(level, func(t *testing.T) {
			if err := configureLogger(level, true); err != nil {
				t.Fatalf("configureLogger(%q): %v", level, err)
			}
		})
	}
}

func TestConfigureLoggerRejectsUnknownLevel(t *testing.T) {
	if err := configureLogger("trace", false); err == nil {
		t.Fatal("configureLogger accepted unsupported level")
	}
}
