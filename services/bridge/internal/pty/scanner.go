package pty

import (
	"bytes"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/protocol"
)

// TmuxSessionInfo contains information about a discovered tmux session
type TmuxSessionInfo struct {
	Name      string
	ProcessID string // Extracted from session name (after rc- prefix)
	Created   time.Time
	Attached  bool
	Width     int
	Height    int
}

// ScanTmuxSessions scans for existing remote-claude tmux sessions on a host
func ScanTmuxSessions(sshClient *ssh.Client) ([]TmuxSessionInfo, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// List sessions with format: name:created:attached:width:height
	// Only list sessions starting with our prefix
	cmd := fmt.Sprintf(`tmux list-sessions -F '#{session_name}:#{session_created}:#{session_attached}:#{session_width}:#{session_height}' 2>/dev/null | grep '^%s'`, TmuxSessionPrefix)

	var stdout bytes.Buffer
	session.Stdout = &stdout

	// Don't fail if no sessions exist (grep returns 1 if no matches)
	session.Run(cmd)

	var sessions []TmuxSessionInfo
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 5 {
			continue
		}

		name := parts[0]
		if !strings.HasPrefix(name, TmuxSessionPrefix) {
			continue
		}

		processID := strings.TrimPrefix(name, TmuxSessionPrefix)
		if processID == "" {
			continue
		}

		// Parse created timestamp (Unix epoch)
		var created time.Time
		var createdEpoch int64
		fmt.Sscanf(parts[1], "%d", &createdEpoch)
		if createdEpoch > 0 {
			created = time.Unix(createdEpoch, 0)
		}

		// Parse attached (0 or 1)
		attached := parts[2] == "1"

		// Parse dimensions
		var width, height int
		fmt.Sscanf(parts[3], "%d", &width)
		fmt.Sscanf(parts[4], "%d", &height)

		sessions = append(sessions, TmuxSessionInfo{
			Name:      name,
			ProcessID: processID,
			Created:   created,
			Attached:  attached,
			Width:     width,
			Height:    height,
		})
	}

	log.Printf("[DEBUG] [PTY] Scanned %d tmux sessions on host", len(sessions))
	return sessions, nil
}

// IsTmuxAvailable checks if tmux is installed on the remote host
func IsTmuxAvailable(sshClient *ssh.Client) bool {
	session, err := sshClient.NewSession()
	if err != nil {
		return false
	}
	defer session.Close()

	err = session.Run("which tmux >/dev/null 2>&1")
	return err == nil
}

// TmuxSessionExists checks if a specific tmux session exists
func TmuxSessionExists(sshClient *ssh.Client, tmuxName string) bool {
	session, err := sshClient.NewSession()
	if err != nil {
		return false
	}
	defer session.Close()

	cmd := fmt.Sprintf("tmux has-session -t %s 2>/dev/null", tmuxName)
	err = session.Run(cmd)
	return err == nil
}

// CheckRequirements checks if claude and agentapi are installed on the remote host
func CheckRequirements(sshClient *ssh.Client) *protocol.HostRequirements {
	requirements := &protocol.HostRequirements{
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// Check for claude
	claudePath := checkCommand(sshClient, "claude")
	if claudePath != "" {
		requirements.ClaudeInstalled = true
		requirements.ClaudePath = &claudePath
	}

	// Check for agentapi
	agentApiPath := checkCommand(sshClient, "agentapi")
	if agentApiPath != "" {
		requirements.AgentAPIInstalled = true
		requirements.AgentAPIPath = &agentApiPath
	}

	log.Printf("[DEBUG] [PTY] Requirements check: claude=%v (%v), agentapi=%v (%v)",
		requirements.ClaudeInstalled, requirements.ClaudePath,
		requirements.AgentAPIInstalled, requirements.AgentAPIPath)

	return requirements
}

// checkCommand checks if a command is available and returns its path
func checkCommand(sshClient *ssh.Client, cmd string) string {
	session, err := sshClient.NewSession()
	if err != nil {
		return ""
	}
	defer session.Close()

	var stdout bytes.Buffer
	session.Stdout = &stdout

	err = session.Run(fmt.Sprintf("which %s 2>/dev/null", cmd))
	if err != nil {
		return ""
	}

	return strings.TrimSpace(stdout.String())
}
