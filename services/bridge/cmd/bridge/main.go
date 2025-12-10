package main

import (
	"flag"
	"log"
	"os"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP server address")
	logLevel := flag.String("log-level", getEnvOrDefault("LOG_LEVEL", "info"), "Log level (debug, info, warn, error)")
	flag.Parse()

	// Configure logging based on log level
	configureLogging(*logLevel)

	log.Printf("[INFO] Remote Claude V2 Bridge starting...")
	log.Printf("[INFO] Log level: %s", *logLevel)
	log.Printf("[INFO] Server address: %s", *addr)

	srv := server.New(*addr)
	if err := srv.Start(); err != nil {
		log.Fatalf("[ERROR] Server failed: %v", err)
	}
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
