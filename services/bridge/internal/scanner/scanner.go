package scanner

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/process"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/protocol"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// ScanResult represents the result of scanning a port
type ScanResult struct {
	Port       int
	Active     bool
	Status     string // "active", "refused", "timeout", "error"
	AgentType  *string
	Error      error
}

// Scanner scans for existing AgentAPI servers through SSH tunnel
type Scanner struct {
	timeout time.Duration
}

// NewScanner creates a new port scanner
func NewScanner() *Scanner {
	return &Scanner{
		timeout: 2 * time.Second,
	}
}

// ScanPorts scans all AgentAPI ports (3284-3299) through the SSH tunnel
// Returns active processes found and stale processes (refused/timeout)
func (s *Scanner) ScanPorts(sshClient *gossh.Client, hostID string) ([]protocol.ProcessInfo, []protocol.StaleProcess) {
	log.Printf("[DEBUG] [SCANNER] Starting port scan for hostID=%s", hostID)

	var wg sync.WaitGroup
	results := make(chan ScanResult, process.MaxPort-process.MinPort+1)

	// Create tunneled HTTP client
	httpClient := ssh.TunnelHTTPClient(sshClient)
	httpClient.Timeout = s.timeout

	// Scan all ports concurrently
	for port := process.MinPort; port <= process.MaxPort; port++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			result := s.scanPort(httpClient, p)
			results <- result
		}(port)
	}

	// Wait for all scans to complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var activeProcesses []protocol.ProcessInfo
	var staleProcesses []protocol.StaleProcess

	for result := range results {
		if result.Active {
			// Found an active AgentAPI server
			proc := protocol.ProcessInfo{
				ID:            fmt.Sprintf("existing-%d", result.Port),
				Type:          protocol.ProcessTypeClaude,
				HostID:        hostID,
				Port:          &result.Port,
				CWD:           "", // Unknown for existing processes
				PtyReady:      false, // No PTY - it's an orphan process
				AgentAPIReady: true,
				StartedAt:     time.Now().Format(time.RFC3339), // Approximate
			}
			activeProcesses = append(activeProcesses, proc)
			log.Printf("[INFO] [SCANNER] Found active AgentAPI on port %d", result.Port)
		} else if result.Status == "refused" || result.Status == "timeout" {
			// Port has a stale/orphaned process indicator
			staleProcesses = append(staleProcesses, protocol.StaleProcess{
				Port:   result.Port,
				Reason: result.Status,
			})
		}
		// "error" status is logged but not reported to client
	}

	log.Printf("[INFO] [SCANNER] Scan complete: %d active, %d stale", len(activeProcesses), len(staleProcesses))
	return activeProcesses, staleProcesses
}

// scanPort checks a single port for an active AgentAPI server
func (s *Scanner) scanPort(client *http.Client, port int) ScanResult {
	url := fmt.Sprintf("http://localhost:%d/status", port)

	resp, err := client.Get(url)
	if err != nil {
		// Determine error type
		errStr := err.Error()
		if contains(errStr, "connection refused") {
			return ScanResult{Port: port, Active: false, Status: "refused"}
		}
		if contains(errStr, "timeout") || contains(errStr, "deadline exceeded") {
			return ScanResult{Port: port, Active: false, Status: "timeout"}
		}
		// Other errors (port likely not bound)
		return ScanResult{Port: port, Active: false, Status: "error", Error: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		// Try to parse response for agent type
		var statusResp struct {
			AgentType string `json:"agent_type"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&statusResp); err == nil && statusResp.AgentType != "" {
			return ScanResult{Port: port, Active: true, Status: "active", AgentType: &statusResp.AgentType}
		}
		return ScanResult{Port: port, Active: true, Status: "active"}
	}

	return ScanResult{Port: port, Active: false, Status: "error"}
}

// contains checks if substr is in s (simple helper to avoid strings import)
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
