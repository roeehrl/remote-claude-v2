package pty

import (
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	// TmuxSessionPrefix is the prefix for all remote-claude tmux sessions
	TmuxSessionPrefix = "rc-"
)

// TmuxSessionName generates a tmux session name from process ID
func TmuxSessionName(processID string) string {
	return TmuxSessionPrefix + processID
}

// Session represents a PTY session backed by tmux for persistence.
// Unlike a raw SSH shell which dies with the connection, tmux sessions persist
// and can be reattached after disconnect/reconnect.
type Session struct {
	ID         string
	HostID     string
	TmuxName   string // tmux session name (rc-{processID})
	sshClient  *ssh.Client
	sshSession *ssh.Session // Current attachment session (nil when detached)
	stdin      io.WriteCloser
	stdout     io.Reader
	stderr     io.Reader
	mu         sync.Mutex
	closed     bool
	attached   bool

	// Terminal dimensions
	Cols int
	Rows int

	// Output handler
	onOutput func(data []byte)

	// Lifecycle
	startedAt time.Time
	cwd       string
}

// SessionConfig contains configuration for creating a PTY session
type SessionConfig struct {
	Cols       int
	Rows       int
	TermType   string
	InitialCWD string
}

// DefaultSessionConfig returns default PTY session configuration
func DefaultSessionConfig() SessionConfig {
	return SessionConfig{
		Cols:     80,
		Rows:     24,
		TermType: "xterm-256color",
	}
}

// NewSession creates a new PTY session backed by tmux.
// This creates a new tmux session on the remote and attaches to it.
func NewSession(id, hostID string, sshClient *ssh.Client, config SessionConfig) (*Session, error) {
	tmuxName := TmuxSessionName(id)
	log.Printf("[DEBUG] [PTY] Creating tmux session id=%s tmuxName=%s cols=%d rows=%d",
		id, tmuxName, config.Cols, config.Rows)

	// First, create the tmux session (detached)
	createSession, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session for tmux create: %w", err)
	}

	// Create detached tmux session with specified size and disable status bar
	// The status bar is disabled to provide a cleaner terminal experience on mobile
	createCmd := fmt.Sprintf("tmux new-session -d -s %s -x %d -y %d \\; set-option -t %s status off",
		tmuxName, config.Cols, config.Rows, tmuxName)
	log.Printf("[DEBUG] [PTY] Running: %s", createCmd)

	if err := createSession.Run(createCmd); err != nil {
		createSession.Close()
		return nil, fmt.Errorf("failed to create tmux session: %w", err)
	}
	createSession.Close()

	// Now create a session object and attach to it
	session := &Session{
		ID:        id,
		HostID:    hostID,
		TmuxName:  tmuxName,
		sshClient: sshClient,
		Cols:      config.Cols,
		Rows:      config.Rows,
		startedAt: time.Now(),
		cwd:       config.InitialCWD,
	}

	// Attach to the tmux session
	if err := session.Attach(); err != nil {
		// Try to clean up the tmux session
		session.Kill()
		return nil, fmt.Errorf("failed to attach to tmux session: %w", err)
	}

	log.Printf("[INFO] [PTY] Session %s created and attached (tmux: %s)", id, tmuxName)
	return session, nil
}

// AttachToExisting attaches to an existing tmux session (for reconnection)
func AttachToExisting(id, hostID, tmuxName string, sshClient *ssh.Client, cols, rows int, startedAt time.Time) (*Session, error) {
	log.Printf("[DEBUG] [PTY] Attaching to existing tmux session id=%s tmuxName=%s", id, tmuxName)

	// Verify the tmux session exists and ensure status bar is disabled
	checkSession, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	// Check session exists AND disable status bar (for sessions created before this feature)
	checkCmd := fmt.Sprintf("tmux has-session -t %s && tmux set-option -t %s status off", tmuxName, tmuxName)
	if err := checkSession.Run(checkCmd); err != nil {
		checkSession.Close()
		return nil, fmt.Errorf("tmux session %s does not exist", tmuxName)
	}
	checkSession.Close()

	session := &Session{
		ID:        id,
		HostID:    hostID,
		TmuxName:  tmuxName,
		sshClient: sshClient,
		Cols:      cols,
		Rows:      rows,
		startedAt: startedAt,
	}

	// Attach to it
	if err := session.Attach(); err != nil {
		return nil, fmt.Errorf("failed to attach to existing tmux session: %w", err)
	}

	log.Printf("[INFO] [PTY] Attached to existing session %s (tmux: %s)", id, tmuxName)
	return session, nil
}

// Attach attaches to the tmux session via SSH
func (s *Session) Attach() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return fmt.Errorf("session is closed")
	}

	if s.attached {
		return nil // Already attached
	}

	// Create SSH session
	sshSession, err := s.sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Request PTY for the tmux attach command
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := sshSession.RequestPty("xterm-256color", s.Rows, s.Cols, modes); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to request PTY: %w", err)
	}

	// Get pipes
	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	// Start tmux attach command
	attachCmd := fmt.Sprintf("tmux attach-session -t %s", s.TmuxName)
	log.Printf("[DEBUG] [PTY] Running: %s", attachCmd)

	if err := sshSession.Start(attachCmd); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to attach to tmux: %w", err)
	}

	s.sshSession = sshSession
	s.stdin = stdin
	s.stdout = stdout
	s.stderr = stderr
	s.attached = true

	log.Printf("[DEBUG] [PTY] Attached to tmux session %s", s.TmuxName)
	return nil
}

// Detach detaches from the tmux session (keeps it running on remote)
func (s *Session) Detach() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.attached {
		return nil // Already detached
	}

	log.Printf("[DEBUG] [PTY] Detaching from session %s", s.ID)

	// Just close the SSH session - tmux will auto-detach
	if s.sshSession != nil {
		s.sshSession.Close()
		s.sshSession = nil
	}

	s.stdin = nil
	s.stdout = nil
	s.stderr = nil
	s.attached = false

	log.Printf("[INFO] [PTY] Detached from session %s (tmux %s still running)", s.ID, s.TmuxName)
	return nil
}

// Kill kills the tmux session entirely
func (s *Session) Kill() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("[DEBUG] [PTY] Killing session %s", s.ID)

	// First detach if attached
	if s.sshSession != nil {
		s.sshSession.Close()
		s.sshSession = nil
	}
	s.stdin = nil
	s.stdout = nil
	s.stderr = nil
	s.attached = false

	// Now kill the tmux session
	killSession, err := s.sshClient.NewSession()
	if err != nil {
		s.closed = true
		return fmt.Errorf("failed to create SSH session for kill: %w", err)
	}
	defer killSession.Close()

	killCmd := fmt.Sprintf("tmux kill-session -t %s 2>/dev/null", s.TmuxName)
	killSession.Run(killCmd) // Ignore error - might already be dead

	s.closed = true
	log.Printf("[INFO] [PTY] Killed session %s (tmux: %s)", s.ID, s.TmuxName)
	return nil
}

// SetOutputHandler sets the callback for output data
func (s *Session) SetOutputHandler(handler func(data []byte)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onOutput = handler
}

// StartOutputLoop starts reading output from the PTY and forwarding it
func (s *Session) StartOutputLoop() {
	s.mu.Lock()
	stdout := s.stdout
	stderr := s.stderr
	s.mu.Unlock()

	if stdout != nil {
		go s.readLoop(stdout, "stdout")
	}
	if stderr != nil {
		go s.readLoop(stderr, "stderr")
	}
}

// readLoop continuously reads from a reader and forwards to handler
func (s *Session) readLoop(reader io.Reader, source string) {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("[DEBUG] [PTY] Read error from %s for session %s: %v", source, s.ID, err)
			}
			return
		}

		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])

			s.mu.Lock()
			handler := s.onOutput
			closed := s.closed
			attached := s.attached
			s.mu.Unlock()

			if closed || !attached {
				return
			}

			if handler != nil {
				handler(data)
			}
		}
	}
}

// Write sends input to the PTY
func (s *Session) Write(data []byte) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("session is closed")
	}
	if !s.attached || s.stdin == nil {
		s.mu.Unlock()
		return fmt.Errorf("session is not attached")
	}
	stdin := s.stdin
	s.mu.Unlock()

	_, err := stdin.Write(data)
	if err != nil {
		log.Printf("[ERROR] [PTY] Write error for session %s: %v", s.ID, err)
		return fmt.Errorf("failed to write to PTY: %w", err)
	}

	return nil
}

// WriteString sends a string to the PTY
func (s *Session) WriteString(str string) error {
	return s.Write([]byte(str))
}

// Resize changes the terminal dimensions
func (s *Session) Resize(cols, rows int) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("session is closed")
	}
	tmuxName := s.TmuxName
	sshClient := s.sshClient
	s.mu.Unlock()

	log.Printf("[DEBUG] [PTY] Resizing session %s to %dx%d", s.ID, cols, rows)

	// First, resize the tmux window/session
	resizeSession, err := sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session for resize: %w", err)
	}
	defer resizeSession.Close()

	// Resize the tmux session
	resizeCmd := fmt.Sprintf("tmux resize-window -t %s -x %d -y %d", tmuxName, cols, rows)
	if err := resizeSession.Run(resizeCmd); err != nil {
		log.Printf("[WARN] [PTY] Resize window failed for session %s: %v (continuing)", s.ID, err)
	}

	// Also send window change to the attached SSH session if we have one
	s.mu.Lock()
	if s.sshSession != nil && s.attached {
		if err := s.sshSession.WindowChange(rows, cols); err != nil {
			log.Printf("[WARN] [PTY] SSH window change failed for session %s: %v", s.ID, err)
		}
	}
	s.Cols = cols
	s.Rows = rows
	s.mu.Unlock()

	return nil
}

// Close terminates the PTY session (kills the tmux session)
func (s *Session) Close() error {
	return s.Kill()
}

// IsClosed returns whether the session is closed
func (s *Session) IsClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// IsAttached returns whether the session is currently attached
func (s *Session) IsAttached() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attached
}

// GetDimensions returns current terminal dimensions
func (s *Session) GetDimensions() (cols, rows int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Cols, s.Rows
}

// GetStartedAt returns when the session was created
func (s *Session) GetStartedAt() time.Time {
	return s.startedAt
}

// GetCWD returns the current working directory (if known)
func (s *Session) GetCWD() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cwd
}

// SetCWD updates the current working directory
func (s *Session) SetCWD(cwd string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cwd = cwd
}

// RefreshCWD queries the current working directory from the tmux pane
// and updates the internal cwd field. Returns the current CWD.
func (s *Session) RefreshCWD() (string, error) {
	s.mu.Lock()
	sshClient := s.sshClient
	tmuxName := s.TmuxName
	s.mu.Unlock()

	if sshClient == nil {
		return "", fmt.Errorf("SSH client not available")
	}

	session, err := sshClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Get the current working directory of the shell in the tmux pane
	// #{pane_current_path} gives us the CWD of the process in the active pane
	cmd := fmt.Sprintf("tmux list-panes -t %s -F '#{pane_current_path}' 2>/dev/null | head -1", tmuxName)
	output, err := session.Output(cmd)
	if err != nil {
		return "", fmt.Errorf("failed to get CWD: %w", err)
	}

	// Trim whitespace from output
	cwd := string(output)
	if len(cwd) > 0 && cwd[len(cwd)-1] == '\n' {
		cwd = cwd[:len(cwd)-1]
	}

	// Update internal state
	s.mu.Lock()
	s.cwd = cwd
	s.mu.Unlock()

	log.Printf("[DEBUG] [PTY] Refreshed CWD for session %s: %s", s.ID, cwd)
	return cwd, nil
}

// GetTmuxName returns the tmux session name
func (s *Session) GetTmuxName() string {
	return s.TmuxName
}

// Wait waits for the SSH session to complete (when tmux detaches or exits)
func (s *Session) Wait() error {
	s.mu.Lock()
	sshSession := s.sshSession
	s.mu.Unlock()

	if sshSession != nil {
		return sshSession.Wait()
	}
	return nil
}

// UpdateSSHClient updates the SSH client (for reconnection scenarios)
func (s *Session) UpdateSSHClient(sshClient *ssh.Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sshClient = sshClient
}

// GetShellPID returns the PID of the shell process running inside the tmux session
func (s *Session) GetShellPID() (int, error) {
	s.mu.Lock()
	sshClient := s.sshClient
	tmuxName := s.TmuxName
	s.mu.Unlock()

	if sshClient == nil {
		return 0, fmt.Errorf("SSH client not available")
	}

	session, err := sshClient.NewSession()
	if err != nil {
		return 0, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Get the PID of the shell running in the tmux pane
	// #{pane_pid} gives us the PID of the process in the active pane
	cmd := fmt.Sprintf("tmux list-panes -t %s -F '#{pane_pid}' 2>/dev/null | head -1", tmuxName)
	output, err := session.Output(cmd)
	if err != nil {
		return 0, fmt.Errorf("failed to get shell PID: %w", err)
	}

	var pid int
	if _, err := fmt.Sscanf(string(output), "%d", &pid); err != nil {
		return 0, fmt.Errorf("failed to parse PID from output %q: %w", string(output), err)
	}

	log.Printf("[DEBUG] [PTY] Got shell PID %d for session %s", pid, s.ID)
	return pid, nil
}
