package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/agentapi"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/process"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/protocol"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/pty"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/scanner"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/session"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/ssh"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/storage"
	cryptossh "golang.org/x/crypto/ssh"
)

// Server represents the Bridge WebSocket server
type Server struct {
	addr            string
	dataDir         string
	upgrader        websocket.Upgrader
	sessionManager  *session.Manager
	sshManager      *ssh.Manager
	processRegistry *process.Registry
	portScanner     *scanner.Scanner
	storage         *storage.Store
	handlers        map[string]MessageHandler
}

// MessageHandler handles a specific message type
type MessageHandler func(s *ConnectedSession, msg *protocol.Message) error

// ConnectedSession wraps a session with its WebSocket connection for message handling
type ConnectedSession struct {
	*session.Session
	server *Server
}

// New creates a new Bridge server
func New(addr string, dataDir string) (*Server, error) {
	// Initialize storage
	dbPath := filepath.Join(dataDir, "bridge.db")
	store, err := storage.NewStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize storage: %w", err)
	}

	s := &Server{
		addr:    addr,
		dataDir: dataDir,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// Allow all origins in development
				// TODO: Restrict in production
				return true
			},
		},
		sessionManager:  session.NewManager(),
		sshManager:      ssh.NewManager(),
		processRegistry: process.NewRegistry(),
		portScanner:     scanner.NewScanner(),
		storage:         store,
		handlers:        make(map[string]MessageHandler),
	}

	// Register message handlers
	s.registerHandlers()

	return s, nil
}

// Stop gracefully shuts down the server
func (s *Server) Stop() {
	log.Printf("[INFO] [SERVER] Shutting down...")

	// Close storage first (persists all data)
	if s.storage != nil {
		if err := s.storage.Close(); err != nil {
			log.Printf("[WARN] [SERVER] Error closing storage: %v", err)
		}
	}

	s.processRegistry.Close()
	s.sshManager.Close()
	s.sessionManager.Stop()

	log.Printf("[INFO] [SERVER] Shutdown complete")
}

// registerHandlers sets up message type handlers
func (s *Server) registerHandlers() {
	s.handlers[protocol.TypeAuth] = s.handleAuth
	s.handlers[protocol.TypeHostConnect] = s.handleHostConnect
	s.handlers[protocol.TypeHostDisconnect] = s.handleHostDisconnect
	s.handlers[protocol.TypeHostCheckRequirements] = s.handleHostCheckRequirements
	s.handlers[protocol.TypeProcessList] = s.handleProcessList
	s.handlers[protocol.TypeProcessCreate] = s.handleProcessCreate
	s.handlers[protocol.TypeProcessKill] = s.handleProcessKill
	s.handlers[protocol.TypeProcessSelect] = s.handleProcessSelect
	s.handlers[protocol.TypeProcessReattach] = s.handleProcessReattach
	s.handlers[protocol.TypeClaudeStart] = s.handleClaudeStart
	s.handlers[protocol.TypeClaudeKill] = s.handleClaudeKill
	s.handlers[protocol.TypePtyInput] = s.handlePtyInput
	s.handlers[protocol.TypePtyResize] = s.handlePtyResize
	s.handlers[protocol.TypePtyHistoryRequest] = s.handlePtyHistoryRequest
	s.handlers[protocol.TypeChatSubscribe] = s.handleChatSubscribe
	s.handlers[protocol.TypeChatUnsubscribe] = s.handleChatUnsubscribe
	s.handlers[protocol.TypeChatSend] = s.handleChatSend
	s.handlers[protocol.TypeChatRaw] = s.handleChatRaw
	s.handlers[protocol.TypeChatStatus] = s.handleChatStatus
	s.handlers[protocol.TypeChatHistory] = s.handleChatHistory
}

// Start starts the HTTP server with WebSocket endpoint
func (s *Server) Start() error {
	http.HandleFunc("/ws", s.handleWebSocket)
	http.HandleFunc("/health", s.handleHealth)

	log.Printf("[INFO] WebSocket endpoint: /ws")
	log.Printf("[INFO] Health endpoint: /health")
	log.Printf("[INFO] Starting server on %s", s.addr)

	return http.ListenAndServe(s.addr, nil)
}

// handleHealth returns server health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// handleWebSocket upgrades HTTP connections to WebSocket
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ERROR] WebSocket upgrade failed: %v", err)
		return
	}

	// Create a new session - reconnection happens via auth message
	sess := s.sessionManager.CreateSession(conn)

	remoteAddr := conn.RemoteAddr().String()
	log.Printf("[DEBUG] [WS] New connection from %s, session=%s", remoteAddr, sess.ID)

	// Handle connection in goroutine
	connSession := &ConnectedSession{
		Session: sess,
		server:  s,
	}
	go s.handleConnection(connSession)
}

// handleConnection handles a WebSocket connection
func (s *Server) handleConnection(connSession *ConnectedSession) {
	defer func() {
		if connSession.Conn != nil {
			connSession.Conn.Close()
		}

		// Detach all PTY sessions for this session's hosts (but don't kill them)
		// This allows processes to continue running and be reattached on reconnect
		s.detachAllProcesses(connSession.ID)

		// Mark as disconnected but don't delete - allow reconnection
		s.sessionManager.MarkDisconnected(connSession.ID)
		log.Printf("[DEBUG] [WS] Session %s disconnected (reconnection allowed, processes detached)", connSession.ID)
	}()

	remoteAddr := connSession.Conn.RemoteAddr().String()

	for {
		messageType, message, err := connSession.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[ERROR] [WS] Read error from %s: %v", remoteAddr, err)
			} else {
				log.Printf("[DEBUG] [WS] Connection closed from %s", remoteAddr)
			}
			return
		}

		if messageType == websocket.TextMessage {
			log.Printf("[DEBUG] [WS] Received from %s: %s", remoteAddr, string(message))
			connSession.LastSeenAt = time.Now()

			// Parse message
			var msg protocol.Message
			if err := json.Unmarshal(message, &msg); err != nil {
				log.Printf("[ERROR] [WS] Failed to parse message: %v", err)
				connSession.SendError("INVALID_MESSAGE", "Failed to parse message")
				continue
			}

			// Route to handler
			handler, ok := s.handlers[msg.Type]
			if !ok {
				log.Printf("[WARN] [WS] Unknown message type: %s", msg.Type)
				connSession.SendError("UNKNOWN_MESSAGE_TYPE", "Unknown message type: "+msg.Type)
				continue
			}

			if err := handler(connSession, &msg); err != nil {
				log.Printf("[ERROR] [WS] Handler error for %s: %v", msg.Type, err)
				connSession.SendError("HANDLER_ERROR", err.Error())
			}
		}
	}
}

// Send sends a message to the client
func (cs *ConnectedSession) Send(msg *protocol.Message) error {
	cs.Session.Lock()
	defer cs.Session.Unlock()

	if cs.Conn == nil {
		return nil // Connection closed, silently ignore
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [WS] Sending to session %s: %s", cs.ID, string(data))
	return cs.Conn.WriteMessage(websocket.TextMessage, data)
}

// SendError sends an error message to the client
func (cs *ConnectedSession) SendError(code, message string) error {
	msg, err := protocol.NewMessage(protocol.TypeError, protocol.ErrorPayload{
		Code:    code,
		Message: message,
	})
	if err != nil {
		return err
	}
	return cs.Send(msg)
}

// ============================================================================
// Message Handlers (stubs for now, will be implemented in later phases)
// ============================================================================

func (s *Server) handleAuth(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.AuthPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		// Empty payload is OK
		log.Printf("[DEBUG] [AUTH] Session %s authenticating (new session)", connSession.ID)
	}

	var reconnected bool
	var finalSession *ConnectedSession = connSession

	// Check if this is a reconnection attempt
	if payload.ReconnectToken != nil && *payload.ReconnectToken != "" {
		log.Printf("[DEBUG] [AUTH] Reconnection attempt with token")

		// Try to reconnect using the token
		existingSession := s.sessionManager.Reconnect(*payload.ReconnectToken, connSession.Conn)
		if existingSession != nil {
			// Successful reconnection - remove the new session that was created on connect
			s.sessionManager.RemoveSession(connSession.ID)

			// Use the existing session
			finalSession = &ConnectedSession{
				Session: existingSession,
				server:  s,
			}
			reconnected = true
			log.Printf("[INFO] [AUTH] Session %s reconnected successfully", existingSession.ID)
		} else {
			log.Printf("[DEBUG] [AUTH] Reconnection failed, treating as new session")
		}
	}

	sessionID := finalSession.ID
	reconnectToken := finalSession.ReconnectToken

	response, err := protocol.NewMessage(protocol.TypeAuthResult, protocol.AuthResultPayload{
		Success:        true,
		SessionID:      &sessionID,
		ReconnectToken: &reconnectToken,
		Reconnected:    reconnected,
	})
	if err != nil {
		return err
	}

	if err := finalSession.Send(response); err != nil {
		return err
	}

	// Send current state of all connected hosts
	// This ensures frontend knows what's already connected after app restart
	s.sendCurrentHostStates(finalSession)

	return nil
}

// sendCurrentHostStates sends HOST_STATUS for all connected SSH hosts
func (s *Server) sendCurrentHostStates(session *ConnectedSession) {
	connectedHosts := s.sshManager.GetAllConnections()
	for _, hostID := range connectedHosts {
		// Get processes for this host from process registry
		processes := s.processRegistry.GetByHost(hostID)
		processInfos := make([]protocol.ProcessInfo, 0, len(processes))
		for _, proc := range processes {
			processInfos = append(processInfos, protocol.ProcessInfo{
				ID:            proc.ID,
				Type:          protocol.ProcessType(proc.Type),
				HostID:        proc.HostID,
				CWD:           proc.CWD,
				Port:          proc.Port,
				PtyReady:      proc.PtyReady,
				AgentAPIReady: proc.AgentAPIReady,
				ShellPID:      proc.ShellPID,
				AgentAPIPID:   proc.AgentAPIPID,
				StartedAt:     proc.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
			})
		}

		msg, err := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:    hostID,
			Connected: true,
			Processes: processInfos,
		})
		if err != nil {
			log.Printf("[ERROR] [AUTH] Failed to create host status message: %v", err)
			continue
		}

		if err := session.Send(msg); err != nil {
			log.Printf("[ERROR] [AUTH] Failed to send host status: %v", err)
		} else {
			log.Printf("[DEBUG] [AUTH] Sent HOST_STATUS for %s with %d processes", hostID, len(processInfos))
		}
	}
}

func (s *Server) handleHostConnect(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostConnectPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [HOST] Connect request: host=%s port=%d user=%s", payload.Host, payload.Port, payload.Username)

	// Build auth config
	authConfig := ssh.AuthConfig{
		AuthType: payload.AuthType,
	}
	if payload.Password != nil {
		authConfig.Password = *payload.Password
	}
	if payload.PrivateKey != nil {
		authConfig.PrivateKey = *payload.PrivateKey
	}

	// Establish SSH connection
	conn, err := s.sshManager.Connect(payload.HostID, payload.Host, payload.Port, payload.Username, authConfig)
	if err != nil {
		log.Printf("[ERROR] [HOST] SSH connection failed: %v", err)
		response, _ := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:    payload.HostID,
			Connected: false,
			Processes: []protocol.ProcessInfo{},
			Error:     strPtr(err.Error()),
		})
		return connSession.Send(response)
	}

	// Track host connection in session
	s.sessionManager.AddHostConnection(connSession.ID, payload.HostID)

	// Scan for existing tmux sessions
	// Returns: reattached processes (already registered) and detached sessions (need manual reattach)
	processInfos, detachedProcesses := s.scanAndRegisterTmuxSessions(connSession, payload.HostID, conn.Client)

	// Also scan for existing AgentAPI servers (for Claude process detection)
	scannedProcesses, staleAgentAPIs := s.portScanner.ScanPorts(conn.Client, payload.HostID)

	// Cross-reference: if we found an AgentAPI on a port, mark the corresponding process as Claude
	for _, scanned := range scannedProcesses {
		if scanned.Port == nil {
			continue
		}
		// Check if any of our tmux processes should be upgraded to Claude
		for i := range processInfos {
			if processInfos[i].Port != nil && *processInfos[i].Port == *scanned.Port {
				// Already has this port - it's a Claude process
				processInfos[i].Type = protocol.ProcessTypeClaude
				processInfos[i].AgentAPIReady = true
				break
			}
		}
	}

	// Merge stale processes: detached tmux sessions + stale AgentAPI ports
	var allStaleProcesses []protocol.StaleProcess
	allStaleProcesses = append(allStaleProcesses, detachedProcesses...)
	allStaleProcesses = append(allStaleProcesses, staleAgentAPIs...)

	// Check requirements (claude and agentapi installation)
	requirements := pty.CheckRequirements(conn.Client)

	log.Printf("[INFO] [HOST] Connected to %s@%s:%d (found %d active, %d detached, %d stale AgentAPI, claude=%v, agentapi=%v)",
		conn.Username, conn.Host, conn.Port, len(processInfos), len(detachedProcesses), len(staleAgentAPIs),
		requirements.ClaudeInstalled, requirements.AgentAPIInstalled)

	var stalePtr *[]protocol.StaleProcess
	if len(allStaleProcesses) > 0 {
		stalePtr = &allStaleProcesses
	}

	response, err := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
		HostID:         payload.HostID,
		Connected:      true,
		Processes:      processInfos,
		StaleProcesses: stalePtr,
		Requirements:   requirements,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleHostDisconnect(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostDisconnectPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [HOST] Disconnect request: hostId=%s", payload.HostID)

	// Detach from all processes for this host (don't kill them)
	// Tmux sessions continue running on the remote host
	procs := s.processRegistry.GetByHost(payload.HostID)
	for _, proc := range procs {
		proc.Detach()
		s.processRegistry.Unregister(proc.ID)
	}

	// Close SSH connection
	s.sshManager.Disconnect(payload.HostID)

	// Remove from session tracking
	s.sessionManager.RemoveHostConnection(connSession.ID, payload.HostID)

	log.Printf("[INFO] [HOST] Disconnected hostID=%s", payload.HostID)
	return nil
}

func (s *Server) handleHostCheckRequirements(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostCheckRequirementsPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [HOST] Check requirements request: hostId=%s", payload.HostID)

	// Get SSH connection for this host
	sshConn := s.sshManager.GetConnection(payload.HostID)
	if sshConn == nil {
		errMsg := "Host not connected"
		response, err := protocol.NewMessage(protocol.TypeHostRequirementsResult, protocol.HostRequirementsResultPayload{
			HostID: payload.HostID,
			Requirements: protocol.HostRequirements{
				CheckedAt: "",
			},
			Error: &errMsg,
		})
		if err != nil {
			return err
		}
		return connSession.Send(response)
	}

	// Check requirements
	requirements := pty.CheckRequirements(sshConn.Client)

	log.Printf("[INFO] [HOST] Requirements check for %s: claude=%v, agentapi=%v",
		payload.HostID, requirements.ClaudeInstalled, requirements.AgentAPIInstalled)

	response, err := protocol.NewMessage(protocol.TypeHostRequirementsResult, protocol.HostRequirementsResultPayload{
		HostID:       payload.HostID,
		Requirements: *requirements,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleProcessList(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessListPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] List request: hostId=%s", payload.HostID)

	// Get processes for this host
	procs := s.processRegistry.GetByHost(payload.HostID)
	var processInfos []protocol.ProcessInfo
	for _, proc := range procs {
		processInfos = append(processInfos, proc.ToInfo())
	}

	response, err := protocol.NewMessage(protocol.TypeProcessListResult, protocol.ProcessListResultPayload{
		HostID:    payload.HostID,
		Processes: processInfos,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleProcessCreate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessCreatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] Create request: hostId=%s", payload.HostID)

	// Get SSH connection for this host
	sshConn := s.sshManager.GetConnection(payload.HostID)
	if sshConn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Generate process ID
	processID := uuid.New().String()

	// Configure PTY
	ptyConfig := pty.DefaultSessionConfig()
	if payload.Cols != nil {
		ptyConfig.Cols = *payload.Cols
	}
	if payload.Rows != nil {
		ptyConfig.Rows = *payload.Rows
	}
	if payload.CWD != nil {
		ptyConfig.InitialCWD = *payload.CWD
	}

	// Create PTY session
	ptySession, err := pty.NewSession(processID, payload.HostID, sshConn.Client, ptyConfig)
	if err != nil {
		log.Printf("[ERROR] [PROCESS] Failed to create PTY session: %v", err)
		return connSession.SendError("PTY_ERROR", err.Error())
	}

	// Create process record
	proc := &process.Process{
		ID:        processID,
		Type:      process.TypeShell,
		HostID:    payload.HostID,
		PTY:       ptySession,
		CWD:       ptyConfig.InitialCWD,
		StartedAt: time.Now(),
		PtyReady:  true,
	}

	// Get and set the shell PID
	if shellPID, err := ptySession.GetShellPID(); err == nil {
		proc.SetShellPID(shellPID)
	} else {
		log.Printf("[WARN] [PROCESS] Could not get shell PID for process %s: %v", processID, err)
	}

	// Register process
	s.processRegistry.Register(proc)

	// Register process with storage for history tracking
	if s.storage != nil {
		s.storage.RegisterProcess(processID, payload.HostID)
	}

	// Set up PTY output handler to forward to WebSocket
	s.updatePtyOutputHandler(connSession, proc)

	// Start reading PTY output
	ptySession.StartOutputLoop()

	log.Printf("[INFO] [PROCESS] Created shell process %s for host %s", processID, payload.HostID)

	// Send process created notification
	response, err := protocol.NewMessage(protocol.TypeProcessCreated, protocol.ProcessCreatedPayload{
		Process: proc.ToInfo(),
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleProcessKill(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessKillPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] Kill request: processId=%s", payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Close the process (PTY)
	if err := proc.Close(); err != nil {
		log.Printf("[WARN] [PROCESS] Error closing process %s: %v", payload.ProcessID, err)
	}

	// Clear history from storage
	if s.storage != nil {
		if err := s.storage.UnregisterProcess(payload.ProcessID); err != nil {
			log.Printf("[WARN] [PROCESS] Error clearing storage for process %s: %v", payload.ProcessID, err)
		}
	}

	// Unregister from registry
	s.processRegistry.Unregister(payload.ProcessID)

	log.Printf("[INFO] [PROCESS] Killed process %s", payload.ProcessID)

	// Send process killed notification
	response, err := protocol.NewMessage(protocol.TypeProcessKilled, protocol.ProcessKilledPayload{
		ProcessID: payload.ProcessID,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleProcessReattach(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessReattachPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] Reattach request: hostId=%s tmuxSession=%s processId=%s",
		payload.HostID, payload.TmuxSession, payload.ProcessID)

	// Get the SSH connection for this host
	conn := s.sshManager.GetConnection(payload.HostID)
	if conn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Check if process already exists (shouldn't happen, but be safe)
	if existingProc := s.processRegistry.Get(payload.ProcessID); existingProc != nil {
		return connSession.SendError("ALREADY_EXISTS", "Process is already registered")
	}

	// Attach to the existing tmux session
	// Use default terminal size - client can resize later
	ptySession, err := pty.AttachToExisting(
		payload.ProcessID,
		payload.HostID,
		payload.TmuxSession,
		conn.Client,
		120, // default cols
		30,  // default rows
		time.Now(), // We don't have the original start time anymore
	)
	if err != nil {
		log.Printf("[ERROR] [PROCESS] Failed to attach to tmux session %s: %v", payload.TmuxSession, err)
		return connSession.SendError("ATTACH_FAILED", fmt.Sprintf("Failed to attach: %v", err))
	}

	// Create process record
	proc := &process.Process{
		ID:        payload.ProcessID,
		Type:      process.TypeShell, // Default to shell
		HostID:    payload.HostID,
		PTY:       ptySession,
		StartedAt: time.Now(),
		PtyReady:  true,
	}

	// Get and set the shell PID
	if shellPID, err := ptySession.GetShellPID(); err == nil {
		proc.SetShellPID(shellPID)
	} else {
		log.Printf("[WARN] [PROCESS] Could not get shell PID for reattached process %s: %v", payload.ProcessID, err)
	}

	// Register process
	s.processRegistry.Register(proc)

	// Set up output handler
	s.updatePtyOutputHandler(connSession, proc)

	// Start output loop
	ptySession.StartOutputLoop()

	log.Printf("[INFO] [PROCESS] Reattached to process %s (tmux: %s)", payload.ProcessID, payload.TmuxSession)

	// Send process created notification
	response, err := protocol.NewMessage(protocol.TypeProcessCreated, protocol.ProcessCreatedPayload{
		Process: proc.ToInfo(),
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleProcessSelect(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessSelectPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] Select request: processId=%s", payload.ProcessID)

	// TODO: Implement in Phase 3
	return nil
}

func (s *Server) handleClaudeStart(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ClaudeStartPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CLAUDE] Start request: processId=%s", payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Verify it's a shell process
	if proc.Type != process.TypeShell {
		return connSession.SendError("INVALID_STATE", "Process is already a Claude process")
	}

	// Verify PTY is ready
	if proc.PTY == nil || !proc.PtyReady {
		return connSession.SendError("PTY_NOT_READY", "PTY is not ready")
	}

	// Get SSH connection for this host
	sshConn := s.sshManager.GetConnection(proc.HostID)
	if sshConn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Allocate a port for AgentAPI
	port, err := s.processRegistry.AllocatePort()
	if err != nil {
		return connSession.SendError("NO_PORTS", err.Error())
	}

	log.Printf("[DEBUG] [CLAUDE] Allocated port %d for process %s", port, payload.ProcessID)

	// Start AgentAPI server in background
	// Command: agentapi server --type=claude --port {port} -- claude &
	// --type=claude is required for proper message formatting
	startCmd := fmt.Sprintf("agentapi server --type=claude --port %d -- claude &\n", port)
	if err := proc.PTY.Write([]byte(startCmd)); err != nil {
		s.processRegistry.ReleasePort(port)
		return connSession.SendError("PTY_ERROR", "Failed to start AgentAPI: "+err.Error())
	}

	// Wait a moment for the server to start
	time.Sleep(500 * time.Millisecond)

	// Start agentapi attach to connect to the running instance
	// Command: agentapi attach --url http://localhost:{port}
	attachCmd := fmt.Sprintf("agentapi attach --url http://localhost:%d\n", port)
	if err := proc.PTY.Write([]byte(attachCmd)); err != nil {
		s.processRegistry.ReleasePort(port)
		return connSession.SendError("PTY_ERROR", "Failed to attach AgentAPI: "+err.Error())
	}

	// Update process state
	proc.SetPort(port)
	proc.UpdateType(process.TypeClaude)

	// Create AgentAPI clients
	agentClient := agentapi.NewClient(sshConn.Client, port)

	// Create SSE client with event handler that forwards to WebSocket
	sseClient := agentapi.NewSSEClient(sshConn.Client, port, func(event agentapi.SSEEvent) {
		s.handleAgentAPIEvent(connSession, proc.HostID, payload.ProcessID, event)
	})

	// Store clients in process
	proc.SetAgentClients(agentClient, sseClient)

	// Start SSE connection
	if err := sseClient.Connect(); err != nil {
		log.Printf("[WARN] [CLAUDE] SSE connection failed for process %s: %v", payload.ProcessID, err)
		// Don't fail - we can still send messages without SSE
	}

	// Wait a bit more then check if AgentAPI is responding
	time.Sleep(1 * time.Second)
	status, err := agentClient.GetStatus()
	if err != nil {
		log.Printf("[WARN] [CLAUDE] Initial status check failed for process %s: %v", payload.ProcessID, err)
		// Don't fail - the server might still be starting
	} else {
		log.Printf("[INFO] [CLAUDE] AgentAPI responding: status=%s", status.Status)
		proc.SetAgentAPIReady(true)
	}

	log.Printf("[INFO] [CLAUDE] Started Claude on process %s (port %d)", payload.ProcessID, port)

	// Send process_updated notification
	response, err := protocol.NewMessage(protocol.TypeProcessUpdated, protocol.ProcessUpdatedPayload{
		ID:            proc.ID,
		Type:          protocol.ProcessTypeClaude,
		Port:          &port,
		PtyReady:      proc.PtyReady,
		AgentAPIReady: proc.AgentAPIReady,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

func (s *Server) handleClaudeKill(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ClaudeKillPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CLAUDE] Kill request: processId=%s", payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Verify it's a Claude process
	if proc.Type != process.TypeClaude {
		return connSession.SendError("INVALID_STATE", "Process is not a Claude process")
	}

	// Close AgentAPI clients
	proc.ClearAgentClients()

	// If we know the AgentAPI PID, try to kill it
	if proc.AgentAPIPID != nil && proc.PTY != nil {
		killCmd := fmt.Sprintf("kill %d 2>/dev/null\n", *proc.AgentAPIPID)
		if err := proc.PTY.Write([]byte(killCmd)); err != nil {
			log.Printf("[WARN] [CLAUDE] Failed to send kill command: %v", err)
		}
		// Wait for it to die
		time.Sleep(500 * time.Millisecond)
	}

	// Release the port
	if proc.Port != nil {
		s.processRegistry.ReleasePort(*proc.Port)
	}

	// Revert process to shell type
	proc.UpdateType(process.TypeShell)
	proc.SetAgentAPIReady(false)
	proc.Port = nil
	proc.AgentAPIPID = nil

	log.Printf("[INFO] [CLAUDE] Killed Claude on process %s, reverted to shell", payload.ProcessID)

	// Send process_updated notification
	response, err := protocol.NewMessage(protocol.TypeProcessUpdated, protocol.ProcessUpdatedPayload{
		ID:            proc.ID,
		Type:          protocol.ProcessTypeShell,
		Port:          nil,
		PtyReady:      proc.PtyReady,
		AgentAPIReady: false,
	})
	if err != nil {
		return err
	}

	return connSession.Send(response)
}

// handleAgentAPIEvent forwards AgentAPI SSE events to the WebSocket client
// and caches message_update events to storage
func (s *Server) handleAgentAPIEvent(connSession *ConnectedSession, hostID, processID string, event agentapi.SSEEvent) {
	log.Printf("[DEBUG] [CLAUDE] Forwarding SSE event: type=%s", event.Type)

	// Cache message_update events to storage
	if event.Type == agentapi.EventMessageUpdate && s.storage != nil {
		var msgData agentapi.MessageUpdateData
		if err := json.Unmarshal(event.Data, &msgData); err == nil {
			if err := s.storage.UpsertChatMessage(processID, hostID, storage.ChatMessage{
				MessageID:   msgData.ID,
				Role:        msgData.Role,
				Message:     msgData.Message,
				MessageTime: msgData.Time,
			}); err != nil {
				log.Printf("[WARN] [CLAUDE] Failed to cache chat message for process %s: %v", processID, err)
			}
		}
	}

	// Forward to WebSocket client
	msg, err := protocol.NewMessage(protocol.TypeChatEvent, protocol.ChatEventPayload{
		HostID:    hostID,
		ProcessID: processID,
		Event:     string(event.Type),
		Data:      event.Data,
	})
	if err != nil {
		log.Printf("[ERROR] [CLAUDE] Failed to create chat event message: %v", err)
		return
	}

	if err := connSession.Send(msg); err != nil {
		log.Printf("[ERROR] [CLAUDE] Failed to send chat event: %v", err)
	}
}

func (s *Server) handlePtyInput(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.PtyInputPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PTY] Input: processId=%s len=%d", payload.ProcessID, len(payload.Data))

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Check if PTY exists
	if proc.PTY == nil {
		return connSession.SendError("NO_PTY", "Process has no PTY")
	}

	// Write to PTY stdin
	if err := proc.PTY.Write([]byte(payload.Data)); err != nil {
		log.Printf("[ERROR] [PTY] Write error for process %s: %v", payload.ProcessID, err)
		return connSession.SendError("PTY_ERROR", err.Error())
	}

	return nil
}

func (s *Server) handlePtyResize(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.PtyResizePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PTY] Resize: processId=%s cols=%d rows=%d", payload.ProcessID, payload.Cols, payload.Rows)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Check if PTY exists
	if proc.PTY == nil {
		return connSession.SendError("NO_PTY", "Process has no PTY")
	}

	// Resize PTY
	if err := proc.PTY.Resize(payload.Cols, payload.Rows); err != nil {
		log.Printf("[ERROR] [PTY] Resize error for process %s: %v", payload.ProcessID, err)
		return connSession.SendError("PTY_ERROR", err.Error())
	}

	return nil
}

func (s *Server) handlePtyHistoryRequest(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.PtyHistoryRequestPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PTY] History request: processId=%s", payload.ProcessID)

	// Check if storage is available
	if s.storage == nil {
		errMsg := "Storage not available"
		response, err := protocol.NewMessage(protocol.TypePtyHistoryComplete, protocol.PtyHistoryCompletePayload{
			ProcessID: payload.ProcessID,
			Success:   false,
			Error:     &errMsg,
		})
		if err != nil {
			return err
		}
		return connSession.Send(response)
	}

	// Get history size
	totalSize := s.storage.GetPtyHistorySize(payload.ProcessID)

	// Send response metadata
	response, err := protocol.NewMessage(protocol.TypePtyHistoryResponse, protocol.PtyHistoryResponsePayload{
		ProcessID:  payload.ProcessID,
		TotalSize:  totalSize,
		Compressed: false, // Not using compression for now
	})
	if err != nil {
		return err
	}
	if err := connSession.Send(response); err != nil {
		return err
	}

	// Get history in chunks
	chunkSize := 64 * 1024 // 64KB chunks
	chunkChan, totalChunks, err := s.storage.GetPtyHistoryChunked(payload.ProcessID, chunkSize)
	if err != nil {
		errMsg := err.Error()
		complete, _ := protocol.NewMessage(protocol.TypePtyHistoryComplete, protocol.PtyHistoryCompletePayload{
			ProcessID: payload.ProcessID,
			Success:   false,
			Error:     &errMsg,
		})
		return connSession.Send(complete)
	}

	// Send chunks
	chunkIndex := 0
	for chunk := range chunkChan {
		isLast := chunkIndex == totalChunks-1

		chunkMsg, err := protocol.NewMessage(protocol.TypePtyHistoryChunk, protocol.PtyHistoryChunkPayload{
			ProcessID:   payload.ProcessID,
			Data:        storage.EncodeBase64(chunk),
			ChunkIndex:  chunkIndex,
			TotalChunks: totalChunks,
			IsLast:      isLast,
		})
		if err != nil {
			log.Printf("[ERROR] [PTY] Failed to create chunk message: %v", err)
			continue
		}

		if err := connSession.Send(chunkMsg); err != nil {
			log.Printf("[ERROR] [PTY] Failed to send chunk: %v", err)
			// Continue trying to send remaining chunks
		}

		chunkIndex++
	}

	// Send completion
	complete, err := protocol.NewMessage(protocol.TypePtyHistoryComplete, protocol.PtyHistoryCompletePayload{
		ProcessID: payload.ProcessID,
		Success:   true,
	})
	if err != nil {
		return err
	}

	log.Printf("[INFO] [PTY] Sent %d history chunks (%d bytes) for process %s", chunkIndex, totalSize, payload.ProcessID)
	return connSession.Send(complete)
}

func (s *Server) handleChatSubscribe(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatSubscribePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] Subscribe: hostId=%s processId=%s", payload.HostID, payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return session.SendError("NOT_FOUND", "Process not found")
	}

	// Check if it's a Claude process with SSE client
	if proc.Type != process.TypeClaude {
		return session.SendError("NOT_CLAUDE", "Process is not a Claude process")
	}

	if proc.SSEClient == nil {
		return session.SendError("NOT_CONNECTED", "AgentAPI not connected")
	}

	// SSE client is already connected (set up during claude_start)
	// The events are being forwarded via handleAgentAPIEvent
	log.Printf("[INFO] [CHAT] Subscribed to events for process %s (SSE already connected)", payload.ProcessID)

	return nil
}

func (s *Server) handleChatUnsubscribe(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatUnsubscribePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] Unsubscribe: hostId=%s processId=%s", payload.HostID, payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		// Process already gone, nothing to unsubscribe
		return nil
	}

	// Note: We don't close the SSE client here because it's shared.
	// The SSE client stays connected as long as the Claude process is running.
	// It will be closed when claude_kill is called.
	log.Printf("[INFO] [CHAT] Unsubscribed from events for process %s", payload.ProcessID)

	return nil
}

func (s *Server) handleChatSend(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatSendPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] Send: hostId=%s processId=%s content=%s", payload.HostID, payload.ProcessID, payload.Content)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return session.SendError("NOT_FOUND", "Process not found")
	}

	// Check if it's a Claude process with AgentAPI client
	if proc.Type != process.TypeClaude {
		return session.SendError("NOT_CLAUDE", "Process is not a Claude process")
	}

	if proc.AgentClient == nil {
		return session.SendError("NOT_CONNECTED", "AgentAPI not connected")
	}

	// SendMessage only works when agent is stable
	if err := proc.AgentClient.SendMessage(payload.Content); err != nil {
		log.Printf("[ERROR] [CHAT] SendMessage failed for process %s: %v", payload.ProcessID, err)
		return session.SendError("SEND_FAILED", err.Error())
	}

	log.Printf("[INFO] [CHAT] Message sent to process %s", payload.ProcessID)
	return nil
}

func (s *Server) handleChatRaw(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatRawPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] Raw: hostId=%s processId=%s len=%d", payload.HostID, payload.ProcessID, len(payload.Content))

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return session.SendError("NOT_FOUND", "Process not found")
	}

	// Check if it's a Claude process with AgentAPI client
	if proc.Type != process.TypeClaude {
		return session.SendError("NOT_CLAUDE", "Process is not a Claude process")
	}

	if proc.AgentClient == nil {
		return session.SendError("NOT_CONNECTED", "AgentAPI not connected")
	}

	// SendRaw works in any state (running or stable)
	if err := proc.AgentClient.SendRaw(payload.Content); err != nil {
		log.Printf("[ERROR] [CHAT] SendRaw failed for process %s: %v", payload.ProcessID, err)
		return session.SendError("SEND_FAILED", err.Error())
	}

	log.Printf("[INFO] [CHAT] Raw input sent to process %s", payload.ProcessID)
	return nil
}

func (s *Server) handleChatStatus(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatStatusPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] Status: hostId=%s processId=%s", payload.HostID, payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		// Process not found - return disconnected
		response, err := protocol.NewMessage(protocol.TypeChatStatusResult, protocol.ChatStatusResultPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Status:    "disconnected",
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	// Check if it's a Claude process
	if proc.Type != process.TypeClaude || proc.AgentClient == nil {
		response, err := protocol.NewMessage(protocol.TypeChatStatusResult, protocol.ChatStatusResultPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Status:    "disconnected",
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	// Get status from AgentAPI
	status, err := proc.AgentClient.GetStatus()
	if err != nil {
		log.Printf("[ERROR] [CHAT] GetStatus failed for process %s: %v", payload.ProcessID, err)
		response, err := protocol.NewMessage(protocol.TypeChatStatusResult, protocol.ChatStatusResultPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Status:    "disconnected",
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	response, err := protocol.NewMessage(protocol.TypeChatStatusResult, protocol.ChatStatusResultPayload{
		HostID:    payload.HostID,
		ProcessID: payload.ProcessID,
		Status:    status.Status,
		AgentType: &status.AgentType,
	})
	if err != nil {
		return err
	}

	return session.Send(response)
}

func (s *Server) handleChatHistory(session *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ChatHistoryPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [CHAT] History: hostId=%s processId=%s", payload.HostID, payload.ProcessID)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		// Process not found - try to get from storage cache
		if s.storage != nil {
			storedMessages, err := s.storage.GetChatHistory(payload.ProcessID)
			if err == nil && len(storedMessages) > 0 {
				chatMessages := make([]protocol.ChatMessage, len(storedMessages))
				for i, m := range storedMessages {
					chatMessages[i] = protocol.ChatMessage{
						ID:      m.MessageID,
						Role:    m.Role,
						Message: m.Message,
						Time:    m.MessageTime,
					}
				}
				response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
					HostID:    payload.HostID,
					ProcessID: payload.ProcessID,
					Messages:  chatMessages,
				})
				if err != nil {
					return err
				}
				return session.Send(response)
			}
		}

		// Return empty messages
		response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Messages:  []protocol.ChatMessage{},
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	// Try to get from storage cache first
	if s.storage != nil {
		storedMessages, err := s.storage.GetChatHistory(payload.ProcessID)
		if err == nil && len(storedMessages) > 0 {
			chatMessages := make([]protocol.ChatMessage, len(storedMessages))
			for i, m := range storedMessages {
				chatMessages[i] = protocol.ChatMessage{
					ID:      m.MessageID,
					Role:    m.Role,
					Message: m.Message,
					Time:    m.MessageTime,
				}
			}
			log.Printf("[DEBUG] [CHAT] Returning %d messages from cache for process %s", len(chatMessages), payload.ProcessID)
			response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
				HostID:    payload.HostID,
				ProcessID: payload.ProcessID,
				Messages:  chatMessages,
			})
			if err != nil {
				return err
			}
			return session.Send(response)
		}
	}

	// Fallback: Get messages from AgentAPI (for initial sync or if cache is empty)
	if proc.Type != process.TypeClaude || proc.AgentClient == nil {
		response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Messages:  []protocol.ChatMessage{},
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	messages, err := proc.AgentClient.GetMessages()
	if err != nil {
		log.Printf("[ERROR] [CHAT] GetMessages failed for process %s: %v", payload.ProcessID, err)
		response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
			HostID:    payload.HostID,
			ProcessID: payload.ProcessID,
			Messages:  []protocol.ChatMessage{},
		})
		if err != nil {
			return err
		}
		return session.Send(response)
	}

	// Convert and cache messages from AgentAPI
	chatMessages := make([]protocol.ChatMessage, len(messages))
	storageMessages := make([]storage.ChatMessage, len(messages))
	for i, m := range messages {
		chatMessages[i] = protocol.ChatMessage{
			ID:      m.ID,
			Role:    m.Role,
			Message: m.Message,
			Time:    m.Time,
		}
		storageMessages[i] = storage.ChatMessage{
			MessageID:   m.ID,
			Role:        m.Role,
			Message:     m.Message,
			MessageTime: m.Time,
		}
	}

	// Sync to storage cache
	if s.storage != nil && len(storageMessages) > 0 {
		if err := s.storage.SyncChatFromAgentAPI(payload.ProcessID, payload.HostID, storageMessages); err != nil {
			log.Printf("[WARN] [CHAT] Failed to sync chat history to cache: %v", err)
		}
	}

	log.Printf("[DEBUG] [CHAT] Returning %d messages from AgentAPI for process %s (synced to cache)", len(chatMessages), payload.ProcessID)
	response, err := protocol.NewMessage(protocol.TypeChatMessages, protocol.ChatMessagesPayload{
		HostID:    payload.HostID,
		ProcessID: payload.ProcessID,
		Messages:  chatMessages,
	})
	if err != nil {
		return err
	}

	return session.Send(response)
}

// Helper function to create string pointer
func strPtr(s string) *string {
	return &s
}

// updatePtyOutputHandler updates a process's PTY output handler to send to a new session
// This is called when a session reconnects to a host with existing processes
func (s *Server) updatePtyOutputHandler(connSession *ConnectedSession, proc *process.Process) {
	processID := proc.ID
	hostID := proc.HostID
	log.Printf("[DEBUG] [PTY] Updating output handler for process %s to session %s", processID, connSession.ID)

	proc.PTY.SetOutputHandler(func(data []byte) {
		// Capture to storage for history
		if s.storage != nil {
			if err := s.storage.AppendPtyOutput(processID, hostID, data); err != nil {
				log.Printf("[WARN] [PTY] Failed to store output for process %s: %v", processID, err)
			}
		}

		// Forward to WebSocket client
		outputMsg, err := protocol.NewMessage(protocol.TypePtyOutput, protocol.PtyOutputPayload{
			ProcessID: processID,
			Data:      string(data),
		})
		if err != nil {
			log.Printf("[ERROR] [PTY] Failed to create output message: %v", err)
			return
		}
		if err := connSession.Send(outputMsg); err != nil {
			log.Printf("[ERROR] [PTY] Failed to send output: %v", err)
		}
	})
}

// detachAllProcesses detaches all PTY sessions for a session's hosts
// This is called on disconnect to allow processes to continue running
func (s *Server) detachAllProcesses(sessionID string) {
	hostIDs := s.sessionManager.GetSessionHostConnections(sessionID)
	for _, hostID := range hostIDs {
		procs := s.processRegistry.GetByHost(hostID)
		for _, proc := range procs {
			if proc.PTY != nil {
				log.Printf("[DEBUG] [PTY] Detaching process %s from session %s", proc.ID, sessionID)
				proc.PTY.Detach()
			}
		}
	}
}

// reattachProcess reattaches to an existing tmux session for a process
func (s *Server) reattachProcess(connSession *ConnectedSession, proc *process.Process, sshClient *cryptossh.Client) error {
	if proc.PTY == nil {
		return fmt.Errorf("process %s has no PTY", proc.ID)
	}

	// Update the SSH client reference
	proc.PTY.UpdateSSHClient(sshClient)

	// Reattach to the tmux session
	if err := proc.PTY.Attach(); err != nil {
		return fmt.Errorf("failed to reattach to tmux session: %w", err)
	}

	// Update output handler to point to new session
	s.updatePtyOutputHandler(connSession, proc)

	// Restart output loop
	proc.PTY.StartOutputLoop()

	log.Printf("[INFO] [PTY] Reattached process %s to session %s", proc.ID, connSession.ID)
	return nil
}

// scanAndRegisterTmuxSessions scans for existing tmux sessions on a host.
// Returns:
// - processInfos: already registered processes that were reattached
// - detachedProcesses: orphaned tmux sessions that need manual reattach
func (s *Server) scanAndRegisterTmuxSessions(connSession *ConnectedSession, hostID string, sshClient *cryptossh.Client) ([]protocol.ProcessInfo, []protocol.StaleProcess) {
	// Scan for tmux sessions
	tmuxSessions, err := pty.ScanTmuxSessions(sshClient)
	if err != nil {
		log.Printf("[WARN] [TMUX] Failed to scan tmux sessions: %v", err)
		return nil, nil
	}

	var processInfos []protocol.ProcessInfo
	var detachedProcesses []protocol.StaleProcess

	for _, tmuxInfo := range tmuxSessions {
		// Check if we already have this process registered
		existingProc := s.processRegistry.Get(tmuxInfo.ProcessID)
		if existingProc != nil {
			// Already registered - just reattach
			if err := s.reattachProcess(connSession, existingProc, sshClient); err != nil {
				log.Printf("[WARN] [TMUX] Failed to reattach to existing process %s: %v", tmuxInfo.ProcessID, err)
				continue
			}
			processInfos = append(processInfos, existingProc.ToInfo())
			continue
		}

		// Orphaned tmux session - report as detached for manual reattach
		log.Printf("[INFO] [TMUX] Found detached tmux session %s", tmuxInfo.Name)
		startedAt := tmuxInfo.Created.Format("2006-01-02T15:04:05Z07:00")
		detachedProcesses = append(detachedProcesses, protocol.StaleProcess{
			Reason:      "detached",
			TmuxSession: &tmuxInfo.Name,
			ProcessID:   &tmuxInfo.ProcessID,
			StartedAt:   &startedAt,
		})
	}

	return processInfos, detachedProcesses
}
