package env

import (
	"fmt"
	"log"
	"regexp"
	"strings"

	"golang.org/x/crypto/ssh"
)

const (
	// Section markers for managed env vars in RC file
	SectionStart = "# >>> remote-claude env >>>"
	SectionEnd   = "# <<< remote-claude env <<<"
)

// EnvVar represents an environment variable
type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Manager handles environment variable operations on remote hosts
type Manager struct{}

// NewManager creates a new env manager
func NewManager() *Manager {
	return &Manager{}
}

// DetectRcFile detects the shell RC file based on the user's shell
func (m *Manager) DetectRcFile(sshClient *ssh.Client) (string, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Get the user's shell
	output, err := session.Output("echo $SHELL")
	if err != nil {
		return "", fmt.Errorf("failed to get shell: %w", err)
	}

	shell := strings.TrimSpace(string(output))
	log.Printf("[DEBUG] [ENV] Detected shell: %s", shell)

	// Map shell to RC file
	switch {
	case strings.Contains(shell, "zsh"):
		return "~/.zshrc", nil
	case strings.Contains(shell, "bash"):
		return "~/.bashrc", nil
	default:
		// Fallback to .profile for other shells
		return "~/.profile", nil
	}
}

// ReadSystemEnvVars reads all environment variables from the remote system
func (m *Manager) ReadSystemEnvVars(sshClient *ssh.Client) ([]EnvVar, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Use env command to get all environment variables
	output, err := session.Output("env")
	if err != nil {
		return nil, fmt.Errorf("failed to get env vars: %w", err)
	}

	return parseEnvOutput(string(output)), nil
}

// CaptureProcessEnvAtSpawn captures environment variables immediately after a shell spawns.
// This should be called ONCE right after the shell is created but before user interaction.
// It runs `env` in the tmux pane to capture the current shell environment (including sourced RC vars).
func (m *Manager) CaptureProcessEnvAtSpawn(sshClient *ssh.Client, tmuxName string) ([]EnvVar, error) {
	// Strategy: send `env` to the tmux pane, write to temp file, then read it back
	// The leading space prevents the command from being saved to shell history
	// We also use `clear` after to hide the output from the user

	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Create temp file path with unique suffix based on tmux session name
	tmpFile := fmt.Sprintf("/tmp/rc_env_%s", strings.ReplaceAll(tmuxName, ":", "_"))

	// Send env command to the tmux session, writing to temp file, then clear the screen
	// Leading space prevents history recording in most shells
	// The && clear hides the env output from the user
	sendCmd := fmt.Sprintf(`tmux send-keys -t %s " env > %s 2>/dev/null && clear" Enter`, tmuxName, tmpFile)
	_, err = session.Output(sendCmd)
	if err != nil {
		log.Printf("[WARN] [ENV] Failed to send env command at spawn: %v", err)
		return nil, fmt.Errorf("failed to send env command: %w", err)
	}

	// Wait a moment for the command to execute
	session2, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session2.Close()

	// Wait and read the temp file
	readCmd := fmt.Sprintf(`sleep 0.3 && cat %s 2>/dev/null && rm -f %s 2>/dev/null`, tmpFile, tmpFile)
	envOutput, err := session2.Output(readCmd)
	if err != nil {
		log.Printf("[WARN] [ENV] Failed to read env output at spawn: %v", err)
		return nil, fmt.Errorf("failed to read env output: %w", err)
	}

	vars := parseEnvOutput(string(envOutput))
	log.Printf("[DEBUG] [ENV] Captured %d env vars at spawn for %s", len(vars), tmuxName)
	return vars, nil
}

// ReadProcessEnvVars is deprecated - use CaptureProcessEnvAtSpawn instead
// This method is kept for fallback purposes only
func (m *Manager) ReadProcessEnvVars(sshClient *ssh.Client, tmuxName string) ([]EnvVar, error) {
	return m.readProcessEnvFallback(sshClient, tmuxName)
}

// readProcessEnvFallback reads env from /proc/<pid>/environ as a fallback
// Note: This only shows the initial environment, not current exported vars
func (m *Manager) readProcessEnvFallback(sshClient *ssh.Client, tmuxName string) ([]EnvVar, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Get the shell PID from tmux
	cmd := fmt.Sprintf("tmux list-panes -t %s -F '#{pane_pid}' | head -1", tmuxName)
	pidOutput, err := session.Output(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to get pane PID: %w", err)
	}

	pid := strings.TrimSpace(string(pidOutput))
	if pid == "" {
		return nil, fmt.Errorf("no PID found for tmux session %s", tmuxName)
	}

	// Get child shell PID (the actual shell in the tmux pane)
	session2, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session2.Close()

	cmd = fmt.Sprintf("pgrep -P %s | head -1", pid)
	childOutput, err := session2.Output(cmd)
	if err != nil {
		childOutput = []byte(pid)
	}
	childPid := strings.TrimSpace(string(childOutput))
	if childPid == "" {
		childPid = pid
	}

	session3, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session3.Close()

	cmd = fmt.Sprintf("cat /proc/%s/environ 2>/dev/null | tr '\\0' '\\n'", childPid)
	envOutput, err := session3.Output(cmd)
	if err != nil {
		log.Printf("[WARN] [ENV] Could not read process environment: %v", err)
		return []EnvVar{}, nil
	}

	return parseEnvOutput(string(envOutput)), nil
}

// ReadCustomEnvVars reads the managed section from the RC file
func (m *Manager) ReadCustomEnvVars(sshClient *ssh.Client, rcFile string) ([]EnvVar, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Read RC file content (expand ~ to $HOME)
	cmd := fmt.Sprintf("cat %s 2>/dev/null || echo ''", rcFile)
	output, err := session.Output(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to read RC file: %w", err)
	}

	content := string(output)
	return extractManagedSection(content), nil
}

// WriteCustomEnvVars writes the managed section to the RC file
func (m *Manager) WriteCustomEnvVars(sshClient *ssh.Client, rcFile string, vars []EnvVar) error {
	// First, read the current RC file
	session, err := sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	cmd := fmt.Sprintf("cat %s 2>/dev/null || echo ''", rcFile)
	output, err := session.Output(cmd)
	if err != nil {
		return fmt.Errorf("failed to read RC file: %w", err)
	}

	content := string(output)

	// Remove existing managed section
	content = removeManagedSection(content)

	// Build new managed section (only if there are vars)
	if len(vars) > 0 {
		newSection := buildManagedSection(vars)
		// Append to end of file
		if !strings.HasSuffix(content, "\n") && content != "" {
			content += "\n"
		}
		content += newSection
	}

	// Write back atomically using a temp file
	session2, err := sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session2.Close()

	// Escape content for shell
	escapedContent := strings.ReplaceAll(content, "'", "'\"'\"'")

	// Write to temp file and mv (atomic)
	cmd = fmt.Sprintf("printf '%%s' '%s' > %s.tmp && mv %s.tmp %s",
		escapedContent, rcFile, rcFile, rcFile)
	_, err = session2.Output(cmd)
	if err != nil {
		return fmt.Errorf("failed to write RC file: %w", err)
	}

	log.Printf("[DEBUG] [ENV] Wrote %d custom env vars to %s", len(vars), rcFile)
	return nil
}

// parseEnvOutput parses output from env command into EnvVar slice
func parseEnvOutput(output string) []EnvVar {
	var vars []EnvVar
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Split on first = only
		idx := strings.Index(line, "=")
		if idx == -1 {
			continue
		}

		key := line[:idx]
		value := line[idx+1:]

		// Skip empty keys
		if key == "" {
			continue
		}

		vars = append(vars, EnvVar{Key: key, Value: value})
	}

	return vars
}

// extractManagedSection extracts env vars from the managed section
func extractManagedSection(content string) []EnvVar {
	var vars []EnvVar

	startIdx := strings.Index(content, SectionStart)
	endIdx := strings.Index(content, SectionEnd)

	if startIdx == -1 || endIdx == -1 || endIdx <= startIdx {
		return vars // No managed section found
	}

	// Extract section content (between markers)
	sectionContent := content[startIdx+len(SectionStart) : endIdx]

	// Parse export statements
	// Match: export KEY=VALUE or export KEY="VALUE" or export KEY='VALUE'
	exportRegex := regexp.MustCompile(`(?m)^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)
	matches := exportRegex.FindAllStringSubmatch(sectionContent, -1)

	for _, match := range matches {
		if len(match) >= 3 {
			key := match[1]
			value := match[2]

			// Remove surrounding quotes if present
			value = strings.TrimSpace(value)
			if (strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) ||
				(strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
				value = value[1 : len(value)-1]
			}

			vars = append(vars, EnvVar{Key: key, Value: value})
		}
	}

	return vars
}

// removeManagedSection removes the managed section from content
func removeManagedSection(content string) string {
	startIdx := strings.Index(content, SectionStart)
	endIdx := strings.Index(content, SectionEnd)

	if startIdx == -1 || endIdx == -1 || endIdx <= startIdx {
		return content // No managed section found
	}

	// Remove from start marker to end marker (inclusive of end marker line)
	endOfEndMarker := endIdx + len(SectionEnd)
	// Also remove trailing newline after end marker
	if endOfEndMarker < len(content) && content[endOfEndMarker] == '\n' {
		endOfEndMarker++
	}

	return content[:startIdx] + content[endOfEndMarker:]
}

// buildManagedSection builds the managed section content
func buildManagedSection(vars []EnvVar) string {
	var sb strings.Builder

	sb.WriteString(SectionStart)
	sb.WriteString("\n")

	for _, v := range vars {
		// Quote values that contain spaces or special chars
		value := v.Value
		if strings.ContainsAny(value, " \t\"'$`\\") {
			// Escape double quotes and use double quotes
			value = strings.ReplaceAll(value, "\\", "\\\\")
			value = strings.ReplaceAll(value, "\"", "\\\"")
			value = strings.ReplaceAll(value, "$", "\\$")
			value = strings.ReplaceAll(value, "`", "\\`")
			value = "\"" + value + "\""
		}

		sb.WriteString(fmt.Sprintf("export %s=%s\n", v.Key, value))
	}

	sb.WriteString(SectionEnd)
	sb.WriteString("\n")

	return sb.String()
}
