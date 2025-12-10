package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP server address")
	dataDir := flag.String("data-dir", getDefaultDataDir(), "Data directory for SQLite database")
	logLevel := flag.String("log-level", getEnvOrDefault("LOG_LEVEL", "info"), "Log level (debug, info, warn, error)")
	flag.Parse()

	// Configure logging based on log level
	configureLogging(*logLevel)

	// Ensure data directory exists
	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatalf("[ERROR] Failed to create data directory: %v", err)
	}

	log.Printf("[INFO] Remote Claude V2 Bridge starting...")
	log.Printf("[INFO] Log level: %s", *logLevel)
	log.Printf("[INFO] Server address: %s", *addr)
	log.Printf("[INFO] Data directory: %s", *dataDir)

	srv, err := server.New(*addr, *dataDir)
	if err != nil {
		log.Fatalf("[ERROR] Failed to create server: %v", err)
	}

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		log.Printf("[INFO] Received shutdown signal")
		srv.Stop()
		os.Exit(0)
	}()

	if err := srv.Start(); err != nil {
		log.Fatalf("[ERROR] Server failed: %v", err)
	}
}

func getDefaultDataDir() string {
	// Try XDG_DATA_HOME first, then fall back to ~/.local/share
	if xdgDataHome := os.Getenv("XDG_DATA_HOME"); xdgDataHome != "" {
		return filepath.Join(xdgDataHome, "remote-claude-bridge")
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "./data"
	}
	return filepath.Join(homeDir, ".local", "share", "remote-claude-bridge")
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func configureLogging(level string) {
	// Set log flags for timestamp and file/line info
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)

	// Debug level shows all logs
	if level == "debug" {
		log.Printf("[DEBUG] Debug logging enabled")
	}
}
