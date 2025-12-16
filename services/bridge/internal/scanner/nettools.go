package scanner

import (
	"log"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

// NetToolResult contains info about a port from network tools
type NetToolResult struct {
	Port    int
	PID     int
	Process string
	User    string
}

// NetToolInfo contains the results of network tool scanning
type NetToolInfo struct {
	Tool    string           // Which tool was used: "ss", "netstat", "lsof"
	Results []NetToolResult
	Error   string           // Error message if no tool available
}

// ScanNetworkPorts uses available network tools (ss, netstat, lsof) to find
// which processes are listening on the AgentAPI ports range.
// It tries tools in order of preference: ss (modern), netstat (legacy), lsof (fallback)
func ScanNetworkPorts(sshClient *ssh.Client, minPort, maxPort int) NetToolInfo {
	// Try ss first (modern, preferred)
	if results, err := trySS(sshClient, minPort, maxPort); err == nil {
		return NetToolInfo{Tool: "ss", Results: results}
	}

	// Try netstat (legacy but widely available)
	if results, err := tryNetstat(sshClient, minPort, maxPort); err == nil {
		return NetToolInfo{Tool: "netstat", Results: results}
	}

	// Try lsof (fallback)
	if results, err := tryLsof(sshClient, minPort, maxPort); err == nil {
		return NetToolInfo{Tool: "lsof", Results: results}
	}

	return NetToolInfo{
		Error: "No network tools available (ss, netstat, or lsof required)",
	}
}

// trySS uses the ss command to scan ports
// ss -tlnp shows TCP listening sockets with process info
func trySS(sshClient *ssh.Client, minPort, maxPort int) ([]NetToolResult, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()

	// ss -tlnp: TCP, listening, numeric, processes
	// Filter for our port range using grep
	cmd := "ss -tlnp 2>/dev/null | grep -E ':(328[4-9]|329[0-9])\\s'"
	output, err := session.Output(cmd)
	if err != nil {
		// Check if ss command exists
		session2, _ := sshClient.NewSession()
		if session2 != nil {
			defer session2.Close()
			if _, err := session2.Output("which ss"); err != nil {
				return nil, err
			}
		}
		// ss exists but no matches, return empty
		return []NetToolResult{}, nil
	}

	return parseSSOutput(string(output), minPort, maxPort), nil
}

// parseSSOutput parses ss -tlnp output
// Format: LISTEN 0 128 0.0.0.0:3284 0.0.0.0:* users:(("node",pid=12345,fd=3))
func parseSSOutput(output string, minPort, maxPort int) []NetToolResult {
	var results []NetToolResult

	// Regex to match port and process info
	// Matches: :PORT followed by users:((...,pid=NNN,...))
	portRe := regexp.MustCompile(`:(\d+)\s+`)
	procRe := regexp.MustCompile(`users:\(\("([^"]+)",pid=(\d+)`)

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		// Extract port
		portMatch := portRe.FindStringSubmatch(line)
		if portMatch == nil {
			continue
		}
		port, _ := strconv.Atoi(portMatch[1])
		if port < minPort || port > maxPort {
			continue
		}

		result := NetToolResult{Port: port}

		// Extract process info
		procMatch := procRe.FindStringSubmatch(line)
		if procMatch != nil {
			result.Process = procMatch[1]
			result.PID, _ = strconv.Atoi(procMatch[2])
		}

		results = append(results, result)
	}

	return results
}

// tryNetstat uses the netstat command to scan ports
func tryNetstat(sshClient *ssh.Client, minPort, maxPort int) ([]NetToolResult, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()

	// netstat -tlnp: TCP, listening, numeric, programs
	cmd := "netstat -tlnp 2>/dev/null | grep -E ':(328[4-9]|329[0-9])\\s'"
	output, err := session.Output(cmd)
	if err != nil {
		// Check if netstat command exists
		session2, _ := sshClient.NewSession()
		if session2 != nil {
			defer session2.Close()
			if _, err := session2.Output("which netstat"); err != nil {
				return nil, err
			}
		}
		// netstat exists but no matches
		return []NetToolResult{}, nil
	}

	return parseNetstatOutput(string(output), minPort, maxPort), nil
}

// parseNetstatOutput parses netstat -tlnp output
// Format: tcp 0 0 0.0.0.0:3284 0.0.0.0:* LISTEN 12345/node
func parseNetstatOutput(output string, minPort, maxPort int) []NetToolResult {
	var results []NetToolResult

	// Regex to match port and PID/process
	portRe := regexp.MustCompile(`:(\d+)\s+`)
	procRe := regexp.MustCompile(`(\d+)/(\S+)\s*$`)

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		// Extract port
		portMatch := portRe.FindStringSubmatch(line)
		if portMatch == nil {
			continue
		}
		port, _ := strconv.Atoi(portMatch[1])
		if port < minPort || port > maxPort {
			continue
		}

		result := NetToolResult{Port: port}

		// Extract PID/process (format: PID/processname)
		procMatch := procRe.FindStringSubmatch(line)
		if procMatch != nil {
			result.PID, _ = strconv.Atoi(procMatch[1])
			result.Process = procMatch[2]
		}

		results = append(results, result)
	}

	return results
}

// tryLsof uses the lsof command to scan ports
func tryLsof(sshClient *ssh.Client, minPort, maxPort int) ([]NetToolResult, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()

	// lsof -iTCP:3284-3299 -sTCP:LISTEN -n -P
	cmd := "lsof -iTCP:3284-3299 -sTCP:LISTEN -n -P 2>/dev/null"
	output, err := session.Output(cmd)
	if err != nil {
		// Check if lsof command exists
		session2, _ := sshClient.NewSession()
		if session2 != nil {
			defer session2.Close()
			if _, err := session2.Output("which lsof"); err != nil {
				return nil, err
			}
		}
		// lsof exists but no matches
		return []NetToolResult{}, nil
	}

	return parseLsofOutput(string(output), minPort, maxPort), nil
}

// parseLsofOutput parses lsof output
// Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
// Example: node 12345 user 23u IPv4 12345 0t0 TCP *:3284 (LISTEN)
func parseLsofOutput(output string, minPort, maxPort int) []NetToolResult {
	var results []NetToolResult

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if line == "" || strings.HasPrefix(line, "COMMAND") {
			continue // Skip header
		}

		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}

		// Extract port from NAME field (e.g., "*:3284" or "127.0.0.1:3284")
		name := fields[8]
		portIdx := strings.LastIndex(name, ":")
		if portIdx == -1 {
			continue
		}
		portStr := strings.TrimSuffix(name[portIdx+1:], "(LISTEN)")
		port, err := strconv.Atoi(portStr)
		if err != nil || port < minPort || port > maxPort {
			continue
		}

		result := NetToolResult{
			Port:    port,
			Process: fields[0],
			User:    fields[2],
		}
		result.PID, _ = strconv.Atoi(fields[1])

		results = append(results, result)
	}

	return results
}

// GetNetToolResultForPort finds the result for a specific port
func (n *NetToolInfo) GetNetToolResultForPort(port int) *NetToolResult {
	for i := range n.Results {
		if n.Results[i].Port == port {
			return &n.Results[i]
		}
	}
	return nil
}

func init() {
	log.Printf("[DEBUG] [NETTOOLS] Network tools scanner initialized")
}
