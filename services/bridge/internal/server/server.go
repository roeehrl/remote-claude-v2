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
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/crypto"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/env"
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
	envManager      *env.Manager
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
		envManager:      env.NewManager(),
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

	// Detach from all processes (don't kill them - they survive bridge restarts)
	// We intentionally do NOT close SSH connections here - just detach from tmux.
	// This ensures tmux sessions keep running on remote hosts.
	// The OS will clean up connections when the process exits.
	s.processRegistry.DetachAll()
	s.sessionManager.Stop()

	log.Printf("[INFO] [SERVER] Shutdown complete")
}

// registerHandlers sets up message type handlers
func (s *Server) registerHandlers() {
	s.handlers[protocol.TypeAuth] = s.handleAuth
	// Host Config (CRUD)
	s.handlers[protocol.TypeHostConfigList] = s.handleHostConfigList
	s.handlers[protocol.TypeHostConfigCreate] = s.handleHostConfigCreate
	s.handlers[protocol.TypeHostConfigUpdate] = s.handleHostConfigUpdate
	s.handlers[protocol.TypeHostConfigDelete] = s.handleHostConfigDelete
	// Host Connection (runtime)
	s.handlers[protocol.TypeHostConnect] = s.handleHostConnect
	s.handlers[protocol.TypeHostDisconnect] = s.handleHostDisconnect
	s.handlers[protocol.TypeHostCheckRequirements] = s.handleHostCheckRequirements
	s.handlers[protocol.TypeProcessList] = s.handleProcessList
	s.handlers[protocol.TypeProcessCreate] = s.handleProcessCreate
	s.handlers[protocol.TypeProcessKill] = s.handleProcessKill
	s.handlers[protocol.TypeProcessSelect] = s.handleProcessSelect
	s.handlers[protocol.TypeProcessReattach] = s.handleProcessReattach
	s.handlers[protocol.TypeProcessRename] = s.handleProcessRename
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
	// Environment Variables
	s.handlers[protocol.TypeEnvList] = s.handleEnvList
	s.handlers[protocol.TypeEnvUpdate] = s.handleEnvUpdate
	s.handlers[protocol.TypeEnvSetRcFile] = s.handleEnvSetRcFile
	s.handlers[protocol.TypeProcessEnvList] = s.handleProcessEnvList
	// Ports Scanning
	s.handlers[protocol.TypePortsScan] = s.handlePortsScan
	// Snippets
	s.handlers[protocol.TypeSnippetList] = s.handleSnippetList
	s.handlers[protocol.TypeSnippetCreate] = s.handleSnippetCreate
	s.handlers[protocol.TypeSnippetUpdate] = s.handleSnippetUpdate
	s.handlers[protocol.TypeSnippetDelete] = s.handleSnippetDelete
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
// It also reattaches any detached PTY sessions to the new WebSocket session
func (s *Server) sendCurrentHostStates(session *ConnectedSession) {
	connectedHosts := s.sshManager.GetAllConnections()
	for _, hostID := range connectedHosts {
		// Get SSH connection for reattachment
		sshConn := s.sshManager.GetConnection(hostID)
		if sshConn == nil {
			log.Printf("[WARN] [AUTH] No SSH connection found for host %s", hostID)
			continue
		}

		// Check if SSH connection is actually alive
		if !sshConn.IsAlive() {
			log.Printf("[WARN] [AUTH] SSH connection for host %s is dead, skipping", hostID)
			// Clean up dead connection and its processes
			procs := s.processRegistry.GetByHost(hostID)
			for _, proc := range procs {
				s.processRegistry.Unregister(proc.ID)
			}
			s.sshManager.Disconnect(hostID)
			continue
		}

		// Get processes for this host from process registry
		processes := s.processRegistry.GetByHost(hostID)
		processInfos := make([]protocol.ProcessInfo, 0, len(processes))
		var staleProcesses []protocol.StaleProcess

		for _, proc := range processes {
			if proc.PTY == nil {
				continue
			}

			// Check if PTY is attached - if not, try to reattach
			if !proc.PTY.IsAttached() {
				log.Printf("[DEBUG] [AUTH] Process %s PTY not attached, attempting reattach", proc.ID)
				if err := s.reattachProcess(session, proc, sshConn.Client); err != nil {
					log.Printf("[WARN] [AUTH] Failed to reattach process %s: %v", proc.ID, err)
					// Report as stale/detached process
					tmuxName := proc.PTY.TmuxName
					startedAt := proc.StartedAt.Format("2006-01-02T15:04:05Z07:00")
					stale := protocol.StaleProcess{
						Reason:      "detached",
						TmuxSession: &tmuxName,
						ProcessID:   &proc.ID,
						StartedAt:   &startedAt,
					}
					// Include port if this was a Claude process
					if proc.Port != nil {
						stale.Port = *proc.Port
					}
					staleProcesses = append(staleProcesses, stale)
					// Unregister from registry since it needs manual reattach
					s.processRegistry.Unregister(proc.ID)
					continue
				}
				log.Printf("[INFO] [AUTH] Successfully reattached process %s", proc.ID)
			} else {
				// PTY is attached but output handler may be pointing to old session
				// Update output handler to point to the new session
				log.Printf("[DEBUG] [AUTH] Process %s already attached, updating output handler", proc.ID)
				s.updatePtyOutputHandler(session, proc)
			}

			// If this is a Claude process, restore/update AgentAPI clients
			if proc.Type == process.TypeClaude && proc.Port != nil {
				port := *proc.Port
				if proc.SSEClient != nil {
					// SSE client exists, just update the handler
					log.Printf("[DEBUG] [AUTH] Updating SSE handler for Claude process %s", proc.ID)
					proc.SSEClient.SetHandler(func(event agentapi.SSEEvent) {
						s.handleAgentAPIEvent(session, proc.HostID, proc.ID, event)
					})
				} else {
					// SSE client doesn't exist, need to restore AgentAPI clients
					log.Printf("[DEBUG] [AUTH] Restoring AgentAPI clients for Claude process %s on port %d", proc.ID, port)

					// Create new AgentAPI client
					agentClient := agentapi.NewClient(sshConn.Client, port)

					// Create new SSE client with event handler pointing to new session
					sseClient := agentapi.NewSSEClient(sshConn.Client, port, func(event agentapi.SSEEvent) {
						s.handleAgentAPIEvent(session, proc.HostID, proc.ID, event)
					})

					// Store new clients
					proc.SetAgentClients(agentClient, sseClient)

					// Start SSE connection
					if err := sseClient.Connect(); err != nil {
						log.Printf("[WARN] [AUTH] SSE reconnection failed for process %s: %v", proc.ID, err)
					}

					// Check if AgentAPI is still responding
					status, err := agentClient.GetStatus()
					if err != nil {
						log.Printf("[WARN] [AUTH] AgentAPI not responding for process %s: %v", proc.ID, err)
						proc.SetAgentAPIReady(false)
					} else {
						log.Printf("[INFO] [AUTH] AgentAPI reconnected for process %s: status=%s", proc.ID, status.Status)
						proc.SetAgentAPIReady(true)
					}
				}
			}

			// Refresh CWD from tmux before sending
			proc.RefreshCWD()

			// Process is attached (or was just reattached), report it
			processInfos = append(processInfos, protocol.ProcessInfo{
				ID:            proc.ID,
				Type:          protocol.ProcessType(proc.Type),
				HostID:        proc.HostID,
				CWD:           proc.CWD,
				Name:          proc.Name,
				Port:          proc.Port,
				PtyReady:      proc.PtyReady,
				AgentAPIReady: proc.AgentAPIReady,
				ShellPID:      proc.ShellPID,
				AgentAPIPID:   proc.AgentAPIPID,
				StartedAt:     proc.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
			})
		}

		// Store stale processes in registry for later updates
		s.processRegistry.SetStaleProcesses(hostID, staleProcesses)

		// Check requirements (claude and agentapi installation)
		requirements := pty.CheckRequirements(sshConn.Client)

		var stalePtr *[]protocol.StaleProcess
		if len(staleProcesses) > 0 {
			stalePtr = &staleProcesses
		}

		msg, err := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:         hostID,
			Connected:      true,
			Processes:      processInfos,
			StaleProcesses: stalePtr,
			Requirements:   requirements,
		})
		if err != nil {
			log.Printf("[ERROR] [AUTH] Failed to create host status message: %v", err)
			continue
		}

		if err := session.Send(msg); err != nil {
			log.Printf("[ERROR] [AUTH] Failed to send host status: %v", err)
		} else {
			log.Printf("[DEBUG] [AUTH] Sent HOST_STATUS for %s with %d processes, %d stale", hostID, len(processInfos), len(staleProcesses))
		}
	}
}

// sendHostStatus sends a HOST_STATUS message with current processes and stale processes for a host
func (s *Server) sendHostStatus(connSession *ConnectedSession, hostID string) error {
	// Get all active processes for this host
	processes := s.processRegistry.GetByHost(hostID)
	processInfos := make([]protocol.ProcessInfo, 0, len(processes))

	for _, proc := range processes {
		// Refresh CWD from tmux before sending
		proc.RefreshCWD()
		processInfos = append(processInfos, proc.ToInfo())
	}

	// Get stale processes from registry
	staleProcesses := s.processRegistry.GetStaleProcesses(hostID)

	var stalePtr *[]protocol.StaleProcess
	if len(staleProcesses) > 0 {
		stalePtr = &staleProcesses
	}

	// Check requirements if we have an SSH connection
	var requirements *protocol.HostRequirements
	if sshConn := s.sshManager.GetConnection(hostID); sshConn != nil {
		requirements = pty.CheckRequirements(sshConn.Client)
	}

	msg, err := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
		HostID:         hostID,
		Connected:      true,
		Processes:      processInfos,
		StaleProcesses: stalePtr,
		Requirements:   requirements,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [HOST] Sent HOST_STATUS for %s with %d processes, %d stale", hostID, len(processInfos), len(staleProcesses))
	return connSession.Send(msg)
}

// ============================================================================
// Host Configuration Handlers (CRUD)
// ============================================================================

func (s *Server) handleHostConfigList(connSession *ConnectedSession, msg *protocol.Message) error {
	hosts, err := s.storage.ListSSHHosts()
	if err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to list hosts: %v", err)
		return s.sendHostConfigListResult(connSession, nil, err)
	}

	// Convert to protocol format (without credentials)
	configHosts := make([]protocol.SSHHostConfig, len(hosts))
	for i, h := range hosts {
		configHosts[i] = protocol.SSHHostConfig{
			ID:          h.ID,
			Name:        h.Name,
			Host:        h.Host,
			Port:        h.Port,
			Username:    h.Username,
			AuthType:    h.AuthType,
			AutoConnect: h.AutoConnect,
			CreatedAt:   h.CreatedAt.Format(time.RFC3339),
			UpdatedAt:   h.UpdatedAt.Format(time.RFC3339),
		}
	}

	return s.sendHostConfigListResult(connSession, configHosts, nil)
}

func (s *Server) sendHostConfigListResult(connSession *ConnectedSession, hosts []protocol.SSHHostConfig, err error) error {
	if hosts == nil {
		hosts = []protocol.SSHHostConfig{}
	}
	msg, _ := protocol.NewMessage(protocol.TypeHostConfigListResult, protocol.HostConfigListResultPayload{
		Hosts: hosts,
	})
	return connSession.Send(msg)
}

func (s *Server) handleHostConfigCreate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostConfigCreatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return s.sendHostConfigCreateResult(connSession, nil, fmt.Errorf("invalid payload: %w", err))
	}

	// Validate required fields
	if payload.Name == "" || payload.Host == "" || payload.Username == "" || payload.Credential == "" {
		return s.sendHostConfigCreateResult(connSession, nil, fmt.Errorf("missing required fields"))
	}

	// Encrypt credential
	encryptedCred, err := crypto.EncryptString(payload.Credential)
	if err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to encrypt credential: %v", err)
		return s.sendHostConfigCreateResult(connSession, nil, fmt.Errorf("failed to encrypt credential"))
	}

	// Generate ID
	hostID := fmt.Sprintf("host_%d_%s", time.Now().UnixMilli(), uuid.New().String()[:8])

	autoConnect := false
	if payload.AutoConnect != nil {
		autoConnect = *payload.AutoConnect
	}

	// Create host record
	host := storage.SSHHost{
		ID:                  hostID,
		Name:                payload.Name,
		Host:                payload.Host,
		Port:                payload.Port,
		Username:            payload.Username,
		AuthType:            payload.AuthType,
		CredentialEncrypted: encryptedCred,
		AutoConnect:         autoConnect,
	}

	if err := s.storage.CreateSSHHost(host); err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to create host: %v", err)
		return s.sendHostConfigCreateResult(connSession, nil, fmt.Errorf("failed to create host"))
	}

	// Return created host (without credential)
	configHost := &protocol.SSHHostConfig{
		ID:          host.ID,
		Name:        host.Name,
		Host:        host.Host,
		Port:        host.Port,
		Username:    host.Username,
		AuthType:    host.AuthType,
		AutoConnect: host.AutoConnect,
		CreatedAt:   time.Now().Format(time.RFC3339),
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}

	log.Printf("[INFO] [HOST_CONFIG] Created host: %s (%s)", host.ID, host.Name)
	return s.sendHostConfigCreateResult(connSession, configHost, nil)
}

func (s *Server) sendHostConfigCreateResult(connSession *ConnectedSession, host *protocol.SSHHostConfig, err error) error {
	payload := protocol.HostConfigCreateResultPayload{
		Success: err == nil,
		Host:    host,
	}
	if err != nil {
		errStr := err.Error()
		payload.Error = &errStr
	}
	msg, _ := protocol.NewMessage(protocol.TypeHostConfigCreateResult, payload)
	return connSession.Send(msg)
}

func (s *Server) handleHostConfigUpdate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostConfigUpdatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return s.sendHostConfigUpdateResult(connSession, nil, fmt.Errorf("invalid payload: %w", err))
	}

	// Get existing host
	existing, err := s.storage.GetSSHHost(payload.ID)
	if err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to get host: %v", err)
		return s.sendHostConfigUpdateResult(connSession, nil, fmt.Errorf("failed to get host"))
	}
	if existing == nil {
		return s.sendHostConfigUpdateResult(connSession, nil, fmt.Errorf("host not found"))
	}

	// Apply updates
	if payload.Name != nil {
		existing.Name = *payload.Name
	}
	if payload.Host != nil {
		existing.Host = *payload.Host
	}
	if payload.Port != nil {
		existing.Port = *payload.Port
	}
	if payload.Username != nil {
		existing.Username = *payload.Username
	}
	if payload.AuthType != nil {
		existing.AuthType = *payload.AuthType
	}
	if payload.AutoConnect != nil {
		existing.AutoConnect = *payload.AutoConnect
	}
	if payload.Credential != nil && *payload.Credential != "" {
		encryptedCred, err := crypto.EncryptString(*payload.Credential)
		if err != nil {
			log.Printf("[ERROR] [HOST_CONFIG] Failed to encrypt credential: %v", err)
			return s.sendHostConfigUpdateResult(connSession, nil, fmt.Errorf("failed to encrypt credential"))
		}
		existing.CredentialEncrypted = encryptedCred
	}

	// Save updates
	if err := s.storage.UpdateSSHHost(*existing); err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to update host: %v", err)
		return s.sendHostConfigUpdateResult(connSession, nil, fmt.Errorf("failed to update host"))
	}

	// Return updated host (without credential)
	configHost := &protocol.SSHHostConfig{
		ID:          existing.ID,
		Name:        existing.Name,
		Host:        existing.Host,
		Port:        existing.Port,
		Username:    existing.Username,
		AuthType:    existing.AuthType,
		AutoConnect: existing.AutoConnect,
		CreatedAt:   existing.CreatedAt.Format(time.RFC3339),
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}

	log.Printf("[INFO] [HOST_CONFIG] Updated host: %s (%s)", existing.ID, existing.Name)
	return s.sendHostConfigUpdateResult(connSession, configHost, nil)
}

func (s *Server) sendHostConfigUpdateResult(connSession *ConnectedSession, host *protocol.SSHHostConfig, err error) error {
	payload := protocol.HostConfigUpdateResultPayload{
		Success: err == nil,
		Host:    host,
	}
	if err != nil {
		errStr := err.Error()
		payload.Error = &errStr
	}
	msg, _ := protocol.NewMessage(protocol.TypeHostConfigUpdateResult, payload)
	return connSession.Send(msg)
}

func (s *Server) handleHostConfigDelete(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostConfigDeletePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return s.sendHostConfigDeleteResult(connSession, "", fmt.Errorf("invalid payload: %w", err))
	}

	// Check if host exists
	existing, err := s.storage.GetSSHHost(payload.ID)
	if err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to get host: %v", err)
		return s.sendHostConfigDeleteResult(connSession, "", fmt.Errorf("failed to get host"))
	}
	if existing == nil {
		return s.sendHostConfigDeleteResult(connSession, "", fmt.Errorf("host not found"))
	}

	// Delete the host
	if err := s.storage.DeleteSSHHost(payload.ID); err != nil {
		log.Printf("[ERROR] [HOST_CONFIG] Failed to delete host: %v", err)
		return s.sendHostConfigDeleteResult(connSession, "", fmt.Errorf("failed to delete host"))
	}

	log.Printf("[INFO] [HOST_CONFIG] Deleted host: %s (%s)", payload.ID, existing.Name)
	return s.sendHostConfigDeleteResult(connSession, payload.ID, nil)
}

func (s *Server) sendHostConfigDeleteResult(connSession *ConnectedSession, id string, err error) error {
	payload := protocol.HostConfigDeleteResultPayload{
		Success: err == nil,
	}
	if err == nil {
		payload.ID = &id
	} else {
		errStr := err.Error()
		payload.Error = &errStr
	}
	msg, _ := protocol.NewMessage(protocol.TypeHostConfigDeleteResult, payload)
	return connSession.Send(msg)
}

// ============================================================================
// Host Connection Handlers (runtime)
// ============================================================================

func (s *Server) handleHostConnect(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.HostConnectPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	// Get host config from storage
	hostConfig, err := s.storage.GetSSHHost(payload.HostID)
	if err != nil {
		log.Printf("[ERROR] [HOST] Failed to get host config: %v", err)
		response, _ := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:    payload.HostID,
			Connected: false,
			Processes: []protocol.ProcessInfo{},
			Error:     strPtr("Failed to get host configuration"),
		})
		return connSession.Send(response)
	}
	if hostConfig == nil {
		log.Printf("[ERROR] [HOST] Host not found: %s", payload.HostID)
		response, _ := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:    payload.HostID,
			Connected: false,
			Processes: []protocol.ProcessInfo{},
			Error:     strPtr("Host not found - please add it in settings first"),
		})
		return connSession.Send(response)
	}

	// Decrypt credential
	credential, err := crypto.DecryptString(hostConfig.CredentialEncrypted)
	if err != nil {
		log.Printf("[ERROR] [HOST] Failed to decrypt credential: %v", err)
		response, _ := protocol.NewMessage(protocol.TypeHostStatus, protocol.HostStatusPayload{
			HostID:    payload.HostID,
			Connected: false,
			Processes: []protocol.ProcessInfo{},
			Error:     strPtr("Failed to decrypt credentials"),
		})
		return connSession.Send(response)
	}

	log.Printf("[DEBUG] [HOST] Connect request: host=%s port=%d user=%s", hostConfig.Host, hostConfig.Port, hostConfig.Username)

	// Build auth config
	authConfig := ssh.AuthConfig{
		AuthType: hostConfig.AuthType,
	}
	if hostConfig.AuthType == "password" {
		authConfig.Password = credential
	} else {
		authConfig.PrivateKey = credential
	}

	// Establish SSH connection
	conn, err := s.sshManager.Connect(payload.HostID, hostConfig.Host, hostConfig.Port, hostConfig.Username, authConfig)
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

	// Mark occupied ports as in-use in the port pool to prevent reallocation
	// This is critical for preventing port conflicts after reconnect
	for _, scanned := range scannedProcesses {
		if scanned.Port != nil {
			s.processRegistry.MarkPortInUse(*scanned.Port)
		}
	}
	for _, stale := range staleAgentAPIs {
		if stale.Port > 0 {
			s.processRegistry.MarkPortInUse(stale.Port)
		}
	}
	// Also mark ports from detached tmux sessions (from stored metadata)
	for _, detached := range detachedProcesses {
		if detached.Port > 0 {
			s.processRegistry.MarkPortInUse(detached.Port)
		}
	}
	// Mark ports from reattached processes (still in registry)
	for _, procInfo := range processInfos {
		if procInfo.Port != nil {
			s.processRegistry.MarkPortInUse(*procInfo.Port)
		}
	}

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

	// Store stale processes in registry for later updates
	s.processRegistry.SetStaleProcesses(payload.HostID, allStaleProcesses)

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

	// Clear stale processes for this host
	s.processRegistry.ClearStaleProcesses(payload.HostID)

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
		// Refresh CWD from tmux before sending
		proc.RefreshCWD()
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

	// Register process with storage for history tracking and metadata persistence
	if s.storage != nil {
		s.storage.RegisterProcess(processID, payload.HostID)

		// Save process metadata for recovery after bridge restart
		shellPID := 0
		if proc.ShellPID != nil {
			shellPID = *proc.ShellPID
		}
		if err := s.storage.SaveProcessMetadata(storage.ProcessMetadata{
			ProcessID:   processID,
			HostID:      payload.HostID,
			ProcessType: "shell",
			TmuxName:    ptySession.TmuxName,
			CWD:         proc.CWD,
			ShellPID:    shellPID,
			StartedAt:   proc.StartedAt,
		}); err != nil {
			log.Printf("[WARN] [PROCESS] Failed to save process metadata: %v", err)
		}
	}

	// Capture environment variables at spawn time (before user interaction)
	// This captures the shell's environment AFTER sourcing RC files
	go func() {
		// Small delay to ensure shell has fully initialized and sourced RC files
		time.Sleep(200 * time.Millisecond)

		envVars, err := s.envManager.CaptureProcessEnvAtSpawn(sshConn.Client, ptySession.TmuxName)
		if err != nil {
			log.Printf("[WARN] [PROCESS] Failed to capture env vars for process %s: %v", processID, err)
			return
		}

		// Convert env.EnvVar to process.EnvVar and store in process
		procEnvVars := make([]process.EnvVar, len(envVars))
		for i, v := range envVars {
			procEnvVars[i] = process.EnvVar{Key: v.Key, Value: v.Value}
		}
		proc.EnvVars = procEnvVars
		log.Printf("[DEBUG] [PROCESS] Captured %d env vars for process %s", len(procEnvVars), processID)

		// Persist env vars to storage for reconnect survival
		if s.storage != nil {
			storageEnvVars := make([]storage.EnvVar, len(envVars))
			for i, v := range envVars {
				storageEnvVars[i] = storage.EnvVar{Key: v.Key, Value: v.Value}
			}
			if err := s.storage.UpdateProcessEnvVars(processID, storageEnvVars); err != nil {
				log.Printf("[WARN] [PROCESS] Failed to persist env vars for process %s: %v", processID, err)
			}
		}
	}()

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

	// Clear history and metadata from storage
	if s.storage != nil {
		if err := s.storage.UnregisterProcess(payload.ProcessID); err != nil {
			log.Printf("[WARN] [PROCESS] Error clearing storage for process %s: %v", payload.ProcessID, err)
		}
		if err := s.storage.DeleteProcessMetadata(payload.ProcessID); err != nil {
			log.Printf("[WARN] [PROCESS] Error deleting metadata for process %s: %v", payload.ProcessID, err)
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

func (s *Server) handleProcessRename(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessRenamePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PROCESS] Rename request: processId=%s name=%q", payload.ProcessID, payload.Name)

	// Get the process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("NOT_FOUND", "Process not found")
	}

	// Update the name in memory
	proc.SetName(payload.Name)

	// Persist the name to database
	if s.storage != nil {
		if err := s.storage.UpdateProcessName(payload.ProcessID, payload.Name); err != nil {
			log.Printf("[WARN] [PROCESS] Failed to persist process name: %v", err)
		}
	}

	// Broadcast process updated to all sessions
	info := proc.ToInfo()
	response, err := protocol.NewMessage(protocol.TypeProcessUpdated, protocol.ProcessUpdatedPayload{
		ID:            info.ID,
		Type:          info.Type,
		Port:          info.Port,
		Name:          info.Name,
		PtyReady:      info.PtyReady,
		AgentAPIReady: info.AgentAPIReady,
		ShellPID:      info.ShellPID,
		AgentAPIPID:   info.AgentAPIPID,
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

	// Get stale process info before removing (to get the port if it was a Claude process)
	staleProc := s.processRegistry.GetStaleProcess(payload.HostID, payload.ProcessID)
	var savedPort int
	var savedName string
	if staleProc != nil {
		log.Printf("[DEBUG] [PROCESS] Found stale process %s with port=%d reason=%s", payload.ProcessID, staleProc.Port, staleProc.Reason)
		if staleProc.Port > 0 {
			savedPort = staleProc.Port
		}
	}

	// Always check storage for metadata (name, port, env vars, etc.)
	var savedEnvVars []process.EnvVar
	if s.storage != nil {
		if meta, err := s.storage.GetProcessMetadata(payload.ProcessID); err == nil && meta != nil {
			log.Printf("[DEBUG] [PROCESS] Found metadata in storage: type=%s port=%d name=%q envVars=%d", meta.ProcessType, meta.Port, meta.Name, len(meta.EnvVars))
			if meta.Port > 0 && savedPort == 0 {
				savedPort = meta.Port
			}
			if meta.Name != "" {
				savedName = meta.Name
			}
			// Load saved env vars
			if len(meta.EnvVars) > 0 {
				savedEnvVars = make([]process.EnvVar, len(meta.EnvVars))
				for i, v := range meta.EnvVars {
					savedEnvVars[i] = process.EnvVar{Key: v.Key, Value: v.Value}
				}
			}
		} else if err != nil {
			log.Printf("[WARN] [PROCESS] Error getting metadata from storage: %v", err)
		} else {
			log.Printf("[DEBUG] [PROCESS] No metadata found in storage for %s", payload.ProcessID)
		}
	}

	// Create process record (default to shell, will restore Claude below if port exists)
	proc := &process.Process{
		ID:        payload.ProcessID,
		Type:      process.TypeShell,
		HostID:    payload.HostID,
		PTY:       ptySession,
		StartedAt: time.Now(),
		PtyReady:  true,
		EnvVars:   savedEnvVars, // Restore saved env vars
	}

	// Restore saved name if available
	if savedName != "" {
		proc.SetName(savedName)
	}

	// Get and set the shell PID
	if shellPID, err := ptySession.GetShellPID(); err == nil {
		proc.SetShellPID(shellPID)
	} else {
		log.Printf("[WARN] [PROCESS] Could not get shell PID for reattached process %s: %v", payload.ProcessID, err)
	}

	// Register process
	s.processRegistry.Register(proc)

	// Remove from stale processes
	s.processRegistry.RemoveStaleProcess(payload.HostID, payload.ProcessID)

	// Set up output handler
	s.updatePtyOutputHandler(connSession, proc)

	// Start output loop
	ptySession.StartOutputLoop()

	// Restore Claude state if we have a saved port
	if savedPort > 0 {
		log.Printf("[INFO] [PROCESS] Attempting to restore Claude state for process %s with port %d", payload.ProcessID, savedPort)
		s.restoreClaude(connSession, proc, conn.Client, savedPort)
		log.Printf("[INFO] [PROCESS] After restoreClaude: process %s type=%s", payload.ProcessID, proc.Type)
	} else {
		log.Printf("[DEBUG] [PROCESS] No saved port found, process %s will remain as shell", payload.ProcessID)
	}

	log.Printf("[INFO] [PROCESS] Reattached to process %s (tmux: %s, type: %s)", payload.ProcessID, payload.TmuxSession, proc.Type)

	// Send HOST_STATUS with updated processes and stale processes
	return s.sendHostStatus(connSession, payload.HostID)
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

	claudeArgsStr := "<nil>"
	if payload.ClaudeArgs != nil {
		claudeArgsStr = *payload.ClaudeArgs
	}
	log.Printf("[DEBUG] [CLAUDE] Start request: processId=%s, claudeArgs=%q", payload.ProcessID, claudeArgsStr)

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
	// Command: agentapi server --type=claude --port {port} -- claude [claudeArgs] &
	// --type=claude is required for proper message formatting
	claudeCmd := "claude"
	if payload.ClaudeArgs != nil && *payload.ClaudeArgs != "" {
		claudeCmd = fmt.Sprintf("claude %s", *payload.ClaudeArgs)
	}
	startCmd := fmt.Sprintf("agentapi server --type=claude --port %d -- %s &\n", port, claudeCmd)
	log.Printf("[DEBUG] [CLAUDE] Executing command: %s", startCmd)
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

	// Detect AgentAPI server PID
	if agentAPIPID, err := s.detectAgentAPIPID(sshConn.Client, port); err == nil {
		proc.SetAgentAPIPID(agentAPIPID)
		log.Printf("[INFO] [CLAUDE] Detected AgentAPI PID: %d", agentAPIPID)
	} else {
		log.Printf("[WARN] [CLAUDE] Could not detect AgentAPI PID: %v", err)
	}

	log.Printf("[INFO] [CLAUDE] Started Claude on process %s (port %d)", payload.ProcessID, port)

	// Persist process type and port to database
	if s.storage != nil {
		if err := s.storage.UpdateProcessType(payload.ProcessID, "claude", port); err != nil {
			log.Printf("[WARN] [CLAUDE] Failed to persist process type for %s: %v", payload.ProcessID, err)
		}
	}

	// Send process_updated notification with all fields including PIDs
	info := proc.ToInfo()
	response, err := protocol.NewMessage(protocol.TypeProcessUpdated, protocol.ProcessUpdatedPayload{
		ID:            info.ID,
		Type:          info.Type,
		Port:          info.Port,
		Name:          info.Name,
		PtyReady:      info.PtyReady,
		AgentAPIReady: info.AgentAPIReady,
		ShellPID:      info.ShellPID,
		AgentAPIPID:   info.AgentAPIPID,
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

	// If this is a Claude process with a port, restore AgentAPI clients
	if proc.Type == process.TypeClaude && proc.Port != nil {
		port := *proc.Port
		log.Printf("[DEBUG] [PTY] Restoring AgentAPI clients for Claude process %s on port %d", proc.ID, port)

		// Clear old clients first
		proc.ClearAgentClients()

		// Create new AgentAPI client
		agentClient := agentapi.NewClient(sshClient, port)

		// Create new SSE client with event handler pointing to new session
		sseClient := agentapi.NewSSEClient(sshClient, port, func(event agentapi.SSEEvent) {
			s.handleAgentAPIEvent(connSession, proc.HostID, proc.ID, event)
		})

		// Store new clients
		proc.SetAgentClients(agentClient, sseClient)

		// Start SSE connection
		if err := sseClient.Connect(); err != nil {
			log.Printf("[WARN] [PTY] SSE reconnection failed for process %s: %v", proc.ID, err)
			// Don't fail - process is still reattached, just no SSE
		}

		// Check if AgentAPI is still responding
		status, err := agentClient.GetStatus()
		if err != nil {
			log.Printf("[WARN] [PTY] AgentAPI not responding for process %s: %v", proc.ID, err)
			proc.SetAgentAPIReady(false)
		} else {
			log.Printf("[INFO] [PTY] AgentAPI reconnected for process %s: status=%s", proc.ID, status.Status)
			proc.SetAgentAPIReady(true)
		}
	}

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

		stale := protocol.StaleProcess{
			Reason:      "detached",
			TmuxSession: &tmuxInfo.Name,
			ProcessID:   &tmuxInfo.ProcessID,
			StartedAt:   &startedAt,
		}

		// Look up stored metadata to get port if this was a Claude process
		if s.storage != nil {
			meta, err := s.storage.GetProcessMetadata(tmuxInfo.ProcessID)
			if err != nil {
				log.Printf("[WARN] [TMUX] Error getting metadata for process %s: %v", tmuxInfo.ProcessID, err)
			} else if meta == nil {
				log.Printf("[DEBUG] [TMUX] No stored metadata found for process %s", tmuxInfo.ProcessID)
			} else {
				log.Printf("[DEBUG] [TMUX] Found stored metadata for process %s: type=%s port=%d", tmuxInfo.ProcessID, meta.ProcessType, meta.Port)
				if meta.Port > 0 {
					stale.Port = meta.Port
				}
			}
		} else {
			log.Printf("[WARN] [TMUX] Storage is nil, cannot look up process metadata")
		}

		detachedProcesses = append(detachedProcesses, stale)
	}

	return processInfos, detachedProcesses
}

// restoreClaude restores Claude state for a reattached process using the saved port
func (s *Server) restoreClaude(connSession *ConnectedSession, proc *process.Process, sshClient *cryptossh.Client, port int) {
	log.Printf("[DEBUG] [CLAUDE] Restoring Claude state for process %s on port %d", proc.ID, port)

	// Create AgentAPI client to check if the server is still responding
	agentClient := agentapi.NewClient(sshClient, port)

	// Check if AgentAPI is responding
	status, err := agentClient.GetStatus()
	if err != nil {
		log.Printf("[WARN] [CLAUDE] AgentAPI on port %d not responding for process %s: %v", port, proc.ID, err)
		log.Printf("[DEBUG] [CLAUDE] Process %s will remain as shell", proc.ID)
		return
	}

	log.Printf("[INFO] [CLAUDE] AgentAPI responding on port %d for process %s: status=%s", port, proc.ID, status.Status)

	// Update process type and port
	proc.UpdateType(process.TypeClaude)
	proc.SetPort(port)

	// Create SSE client with event handler
	sseClient := agentapi.NewSSEClient(sshClient, port, func(event agentapi.SSEEvent) {
		s.handleAgentAPIEvent(connSession, proc.HostID, proc.ID, event)
	})

	// Store clients in process
	proc.SetAgentClients(agentClient, sseClient)

	// Start SSE connection
	if err := sseClient.Connect(); err != nil {
		log.Printf("[WARN] [CLAUDE] SSE connection failed for process %s: %v", proc.ID, err)
	}

	proc.SetAgentAPIReady(true)

	// Detect AgentAPI server PID
	if agentAPIPID, err := s.detectAgentAPIPID(sshClient, port); err == nil {
		proc.SetAgentAPIPID(agentAPIPID)
		log.Printf("[INFO] [CLAUDE] Detected AgentAPI PID: %d", agentAPIPID)
	} else {
		log.Printf("[WARN] [CLAUDE] Could not detect AgentAPI PID: %v", err)
	}

	log.Printf("[INFO] [CLAUDE] Successfully restored Claude state for process %s", proc.ID)
}

// detectAgentAPIPID finds the PID of the agentapi server process on the given port
func (s *Server) detectAgentAPIPID(sshClient *cryptossh.Client, port int) (int, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return 0, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Use lsof to find the process listening on the port
	cmd := fmt.Sprintf("lsof -ti :%d 2>/dev/null | head -1", port)
	output, err := session.Output(cmd)
	if err != nil {
		return 0, fmt.Errorf("lsof command failed: %w", err)
	}

	var pid int
	if _, err := fmt.Sscanf(string(output), "%d", &pid); err != nil {
		return 0, fmt.Errorf("failed to parse PID from output %q: %w", string(output), err)
	}

	return pid, nil
}

// ============================================================================
// Environment Variable Handlers
// ============================================================================

// handleEnvList returns system and custom env vars for a host
func (s *Server) handleEnvList(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.EnvListPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] List request for host %s", payload.HostID)

	// Get SSH connection
	sshConn := s.sshManager.GetConnection(payload.HostID)
	if sshConn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Detect RC file
	detectedRcFile, err := s.envManager.DetectRcFile(sshConn.Client)
	if err != nil {
		log.Printf("[WARN] [ENV] Failed to detect RC file: %v", err)
		detectedRcFile = "~/.bashrc" // Default fallback
	}

	// Check for override in storage
	rcFileOverride, err := s.storage.GetHostRcFile(payload.HostID)
	if err != nil {
		log.Printf("[WARN] [ENV] Failed to get RC file override: %v", err)
	}

	rcFile := detectedRcFile
	if rcFileOverride != "" {
		rcFile = rcFileOverride
	}

	// Read system env vars
	systemVars, err := s.envManager.ReadSystemEnvVars(sshConn.Client)
	if err != nil {
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeEnvResult, protocol.EnvResultPayload{
			HostID:         payload.HostID,
			SystemVars:     []protocol.EnvVar{},
			CustomVars:     []protocol.EnvVar{},
			RcFile:         rcFile,
			DetectedRcFile: detectedRcFile,
			Error:          &errMsg,
		})
		return connSession.Send(response)
	}

	// Read custom env vars from RC file
	customEnvVars, err := s.envManager.ReadCustomEnvVars(sshConn.Client, rcFile)
	if err != nil {
		log.Printf("[WARN] [ENV] Failed to read custom env vars: %v", err)
		customEnvVars = []env.EnvVar{}
	}

	// Convert to protocol types
	sysVars := make([]protocol.EnvVar, len(systemVars))
	for i, v := range systemVars {
		sysVars[i] = protocol.EnvVar{Key: v.Key, Value: v.Value}
	}

	custVars := make([]protocol.EnvVar, len(customEnvVars))
	for i, v := range customEnvVars {
		custVars[i] = protocol.EnvVar{Key: v.Key, Value: v.Value}
	}

	response, err := protocol.NewMessage(protocol.TypeEnvResult, protocol.EnvResultPayload{
		HostID:         payload.HostID,
		SystemVars:     sysVars,
		CustomVars:     custVars,
		RcFile:         rcFile,
		DetectedRcFile: detectedRcFile,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] Returning %d system vars, %d custom vars for host %s", len(sysVars), len(custVars), payload.HostID)
	return connSession.Send(response)
}

// handleEnvUpdate updates custom env vars in the RC file
func (s *Server) handleEnvUpdate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.EnvUpdatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] Update request for host %s with %d vars", payload.HostID, len(payload.CustomVars))

	// Get SSH connection
	sshConn := s.sshManager.GetConnection(payload.HostID)
	if sshConn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Get RC file (with override check)
	detectedRcFile, _ := s.envManager.DetectRcFile(sshConn.Client)
	if detectedRcFile == "" {
		detectedRcFile = "~/.bashrc"
	}

	rcFileOverride, _ := s.storage.GetHostRcFile(payload.HostID)
	rcFile := detectedRcFile
	if rcFileOverride != "" {
		rcFile = rcFileOverride
	}

	// Convert to env types
	vars := make([]env.EnvVar, len(payload.CustomVars))
	for i, v := range payload.CustomVars {
		vars[i] = env.EnvVar{Key: v.Key, Value: v.Value}
	}

	// Write custom env vars
	if err := s.envManager.WriteCustomEnvVars(sshConn.Client, rcFile, vars); err != nil {
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeEnvResult, protocol.EnvResultPayload{
			HostID:         payload.HostID,
			SystemVars:     []protocol.EnvVar{},
			CustomVars:     payload.CustomVars,
			RcFile:         rcFile,
			DetectedRcFile: detectedRcFile,
			Error:          &errMsg,
		})
		return connSession.Send(response)
	}

	// Re-read system vars and return updated state
	systemVars, _ := s.envManager.ReadSystemEnvVars(sshConn.Client)
	sysVars := make([]protocol.EnvVar, len(systemVars))
	for i, v := range systemVars {
		sysVars[i] = protocol.EnvVar{Key: v.Key, Value: v.Value}
	}

	response, err := protocol.NewMessage(protocol.TypeEnvResult, protocol.EnvResultPayload{
		HostID:         payload.HostID,
		SystemVars:     sysVars,
		CustomVars:     payload.CustomVars,
		RcFile:         rcFile,
		DetectedRcFile: detectedRcFile,
	})
	if err != nil {
		return err
	}

	log.Printf("[INFO] [ENV] Updated %d custom env vars for host %s", len(payload.CustomVars), payload.HostID)
	return connSession.Send(response)
}

// handleEnvSetRcFile saves the RC file override for a host
func (s *Server) handleEnvSetRcFile(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.EnvSetRcFilePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] Set RC file for host %s to %s", payload.HostID, payload.RcFile)

	// Save to storage
	if err := s.storage.SetHostRcFile(payload.HostID, payload.RcFile); err != nil {
		return connSession.SendError("STORAGE_ERROR", err.Error())
	}

	// Return updated env list
	return s.handleEnvList(connSession, msg)
}

// handleProcessEnvList returns env vars for a specific process
// These env vars were captured at spawn time and stored in the process
func (s *Server) handleProcessEnvList(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.ProcessEnvListPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] Process env list for process %s", payload.ProcessID)

	// Get process
	proc := s.processRegistry.Get(payload.ProcessID)
	if proc == nil {
		return connSession.SendError("PROCESS_NOT_FOUND", "Process not found")
	}

	// Return the env vars that were captured at spawn time
	vars := make([]protocol.EnvVar, len(proc.EnvVars))
	for i, v := range proc.EnvVars {
		vars[i] = protocol.EnvVar{Key: v.Key, Value: v.Value}
	}

	response, err := protocol.NewMessage(protocol.TypeProcessEnvResult, protocol.ProcessEnvResultPayload{
		ProcessID: payload.ProcessID,
		Vars:      vars,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [ENV] Returning %d env vars for process %s", len(vars), payload.ProcessID)
	return connSession.Send(response)
}

// ============================================================================
// Ports Scanning Handlers
// ============================================================================

func (s *Server) handlePortsScan(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.PortsScanPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [PORTS] Scanning ports for host %s", payload.HostID)

	// Get SSH connection for the host
	sshConn := s.sshManager.GetConnection(payload.HostID)
	if sshConn == nil {
		return connSession.SendError("NOT_CONNECTED", "Host is not connected")
	}

	// Get port scan results from the existing scanner
	scannedProcesses, staleAgentAPIs := s.portScanner.ScanPorts(sshConn.Client, payload.HostID)

	// Get network tool info for process enrichment
	netInfo := scanner.ScanNetworkPorts(sshConn.Client, process.MinPort, process.MaxPort)

	// Get process metadata from DB for mapping ports to known processes
	var dbMetadata []storage.ProcessMetadata
	if s.storage != nil {
		var err error
		dbMetadata, err = s.storage.GetProcessMetadataByHost(payload.HostID)
		if err != nil {
			log.Printf("[WARN] [PORTS] Failed to get process metadata from DB: %v", err)
		}
	}

	// Build a map of port -> process metadata from DB
	portToMetadata := make(map[int]*storage.ProcessMetadata)
	for i := range dbMetadata {
		if dbMetadata[i].Port > 0 {
			portToMetadata[dbMetadata[i].Port] = &dbMetadata[i]
		}
	}

	// Build port info list combining all sources
	portInfoMap := make(map[int]*protocol.PortInfo)

	// Add scanned active processes
	for _, scanned := range scannedProcesses {
		if scanned.Port == nil {
			continue
		}
		port := *scanned.Port
		portInfoMap[port] = &protocol.PortInfo{
			Port:   port,
			Status: "active",
		}
	}

	// Add stale processes
	for _, stale := range staleAgentAPIs {
		if stale.Port == 0 {
			continue
		}
		if _, exists := portInfoMap[stale.Port]; !exists {
			portInfoMap[stale.Port] = &protocol.PortInfo{
				Port:   stale.Port,
				Status: stale.Reason,
			}
		}
	}

	// Enrich with DB metadata
	for port, info := range portInfoMap {
		if meta, ok := portToMetadata[port]; ok {
			info.ProcessID = &meta.ProcessID
			info.ProcessName = nilIfEmpty(meta.Name)
			procType := protocol.ProcessType(meta.ProcessType)
			info.ProcessType = &procType
		}
	}

	// Enrich with network tool info
	for port, info := range portInfoMap {
		if netResult := netInfo.GetNetToolResultForPort(port); netResult != nil {
			if netResult.PID > 0 {
				info.NetPID = &netResult.PID
			}
			if netResult.Process != "" {
				info.NetProcess = &netResult.Process
			}
			if netResult.User != "" {
				info.NetUser = &netResult.User
			}
		}
	}

	// Convert map to slice
	var ports []protocol.PortInfo
	for _, info := range portInfoMap {
		ports = append(ports, *info)
	}

	// Build response
	result := protocol.PortsResultPayload{
		HostID: payload.HostID,
		Ports:  ports,
	}

	if netInfo.Tool != "" {
		result.NetTool = &netInfo.Tool
	}
	if netInfo.Error != "" {
		result.NetToolError = &netInfo.Error
	}

	response, err := protocol.NewMessage(protocol.TypePortsResult, result)
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [PORTS] Found %d ports (netTool=%s)", len(ports), netInfo.Tool)
	return connSession.Send(response)
}

// nilIfEmpty returns nil if the string is empty, otherwise returns a pointer to it
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ============================================================================
// Snippet Handlers
// ============================================================================

// handleSnippetList returns all stored snippets
func (s *Server) handleSnippetList(connSession *ConnectedSession, msg *protocol.Message) error {
	log.Printf("[DEBUG] [SNIPPETS] Listing all snippets")

	snippets, err := s.storage.ListSnippets()
	if err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to list snippets: %v", err)
		return connSession.SendError("STORAGE_ERROR", err.Error())
	}

	// Convert storage snippets to protocol snippets
	protoSnippets := make([]protocol.Snippet, len(snippets))
	for i, snippet := range snippets {
		protoSnippets[i] = protocol.Snippet{
			ID:        snippet.ID,
			Name:      snippet.Name,
			Content:   snippet.Content,
			CreatedAt: snippet.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: snippet.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	response, err := protocol.NewMessage(protocol.TypeSnippetListResult, protocol.SnippetListResultPayload{
		Snippets: protoSnippets,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Returning %d snippets", len(protoSnippets))
	return connSession.Send(response)
}

// handleSnippetCreate creates a new snippet
func (s *Server) handleSnippetCreate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.SnippetCreatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Creating snippet: %s", payload.Name)

	// Validate input
	if payload.Name == "" {
		errMsg := "snippet name is required"
		response, _ := protocol.NewMessage(protocol.TypeSnippetCreateResult, protocol.SnippetCreateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	// Create snippet
	snippet := storage.Snippet{
		ID:      uuid.New().String(),
		Name:    payload.Name,
		Content: payload.Content,
	}

	if err := s.storage.CreateSnippet(snippet); err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to create snippet: %v", err)
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeSnippetCreateResult, protocol.SnippetCreateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	// Get the created snippet back (to get timestamps)
	created, err := s.storage.GetSnippet(snippet.ID)
	if err != nil || created == nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to get created snippet: %v", err)
		errMsg := "snippet created but failed to retrieve"
		response, _ := protocol.NewMessage(protocol.TypeSnippetCreateResult, protocol.SnippetCreateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	protoSnippet := protocol.Snippet{
		ID:        created.ID,
		Name:      created.Name,
		Content:   created.Content,
		CreatedAt: created.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: created.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	response, err := protocol.NewMessage(protocol.TypeSnippetCreateResult, protocol.SnippetCreateResultPayload{
		Success: true,
		Snippet: &protoSnippet,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Created snippet %s", snippet.ID)
	return connSession.Send(response)
}

// handleSnippetUpdate updates an existing snippet
func (s *Server) handleSnippetUpdate(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.SnippetUpdatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Updating snippet: %s", payload.ID)

	// Get existing snippet
	existing, err := s.storage.GetSnippet(payload.ID)
	if err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to get snippet: %v", err)
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeSnippetUpdateResult, protocol.SnippetUpdateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}
	if existing == nil {
		errMsg := "snippet not found"
		response, _ := protocol.NewMessage(protocol.TypeSnippetUpdateResult, protocol.SnippetUpdateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	// Update fields if provided
	if payload.Name != nil {
		existing.Name = *payload.Name
	}
	if payload.Content != nil {
		existing.Content = *payload.Content
	}

	if err := s.storage.UpdateSnippet(*existing); err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to update snippet: %v", err)
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeSnippetUpdateResult, protocol.SnippetUpdateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	// Get the updated snippet back
	updated, err := s.storage.GetSnippet(payload.ID)
	if err != nil || updated == nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to get updated snippet: %v", err)
		errMsg := "snippet updated but failed to retrieve"
		response, _ := protocol.NewMessage(protocol.TypeSnippetUpdateResult, protocol.SnippetUpdateResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	protoSnippet := protocol.Snippet{
		ID:        updated.ID,
		Name:      updated.Name,
		Content:   updated.Content,
		CreatedAt: updated.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: updated.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	response, err := protocol.NewMessage(protocol.TypeSnippetUpdateResult, protocol.SnippetUpdateResultPayload{
		Success: true,
		Snippet: &protoSnippet,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Updated snippet %s", payload.ID)
	return connSession.Send(response)
}

// handleSnippetDelete deletes a snippet
func (s *Server) handleSnippetDelete(connSession *ConnectedSession, msg *protocol.Message) error {
	var payload protocol.SnippetDeletePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Deleting snippet: %s", payload.ID)

	// Check if snippet exists
	existing, err := s.storage.GetSnippet(payload.ID)
	if err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to get snippet: %v", err)
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeSnippetDeleteResult, protocol.SnippetDeleteResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}
	if existing == nil {
		errMsg := "snippet not found"
		response, _ := protocol.NewMessage(protocol.TypeSnippetDeleteResult, protocol.SnippetDeleteResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	if err := s.storage.DeleteSnippet(payload.ID); err != nil {
		log.Printf("[ERROR] [SNIPPETS] Failed to delete snippet: %v", err)
		errMsg := err.Error()
		response, _ := protocol.NewMessage(protocol.TypeSnippetDeleteResult, protocol.SnippetDeleteResultPayload{
			Success: false,
			Error:   &errMsg,
		})
		return connSession.Send(response)
	}

	id := payload.ID
	response, err := protocol.NewMessage(protocol.TypeSnippetDeleteResult, protocol.SnippetDeleteResultPayload{
		Success: true,
		ID:      &id,
	})
	if err != nil {
		return err
	}

	log.Printf("[DEBUG] [SNIPPETS] Deleted snippet %s", payload.ID)
	return connSession.Send(response)
}
