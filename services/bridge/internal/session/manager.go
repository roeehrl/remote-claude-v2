package session

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// SessionState tracks the overall state of a session
type SessionState string

const (
	StateConnected    SessionState = "connected"
	StateDisconnected SessionState = "disconnected"
	StateReconnecting SessionState = "reconnecting"
)

// Session represents a client session that can persist across WebSocket reconnections
type Session struct {
	ID         string
	Conn       *websocket.Conn
	mu         sync.Mutex
	State      SessionState
	CreatedAt  time.Time
	LastSeenAt time.Time

	// Host connections owned by this session
	HostConnections map[string]bool // hostID -> connected

	// Reconnection support
	ReconnectToken string    // Token for reconnection validation
	DisconnectedAt time.Time // When the session was disconnected
}

// Lock locks the session mutex
func (s *Session) Lock() {
	s.mu.Lock()
}

// Unlock unlocks the session mutex
func (s *Session) Unlock() {
	s.mu.Unlock()
}

// Manager handles session lifecycle and reconnection
type Manager struct {
	sessions       sync.Map // map[sessionID]*Session
	tokenToSession sync.Map // map[reconnectToken]sessionID

	// Configurable timeouts
	SessionTimeout   time.Duration // How long to keep disconnected sessions
	CleanupInterval  time.Duration // How often to run cleanup
	ReconnectTimeout time.Duration // How long to allow reconnection

	stopCleanup chan struct{}
}

// NewManager creates a new session manager
func NewManager() *Manager {
	m := &Manager{
		SessionTimeout:   5 * time.Minute,  // Keep sessions for 5 minutes after disconnect
		CleanupInterval:  30 * time.Second, // Clean up every 30 seconds
		ReconnectTimeout: 2 * time.Minute,  // Allow reconnection for 2 minutes
		stopCleanup:      make(chan struct{}),
	}

	// Start cleanup goroutine
	go m.cleanupLoop()

	return m
}

// Stop stops the session manager's cleanup goroutine
func (m *Manager) Stop() {
	close(m.stopCleanup)
}

// cleanupLoop periodically cleans up expired sessions
func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(m.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.cleanupExpiredSessions()
		case <-m.stopCleanup:
			return
		}
	}
}

// cleanupExpiredSessions removes sessions that have been disconnected too long
func (m *Manager) cleanupExpiredSessions() {
	now := time.Now()
	var expiredSessions []string

	m.sessions.Range(func(key, value interface{}) bool {
		session := value.(*Session)
		if session.State == StateDisconnected {
			if now.Sub(session.DisconnectedAt) > m.SessionTimeout {
				expiredSessions = append(expiredSessions, session.ID)
			}
		}
		return true
	})

	for _, sessionID := range expiredSessions {
		if sessionVal, ok := m.sessions.Load(sessionID); ok {
			session := sessionVal.(*Session)
			log.Printf("[DEBUG] [SESSION] Cleaning up expired session: %s (disconnected at %s)",
				sessionID, session.DisconnectedAt.Format(time.RFC3339))

			// Remove reconnect token mapping
			if session.ReconnectToken != "" {
				m.tokenToSession.Delete(session.ReconnectToken)
			}

			// Remove session
			m.sessions.Delete(sessionID)
		}
	}

	if len(expiredSessions) > 0 {
		log.Printf("[INFO] [SESSION] Cleaned up %d expired sessions", len(expiredSessions))
	}
}

// CreateSession creates a new session with a WebSocket connection
func (m *Manager) CreateSession(conn *websocket.Conn) *Session {
	session := &Session{
		ID:              uuid.New().String(),
		Conn:            conn,
		State:           StateConnected,
		CreatedAt:       time.Now(),
		LastSeenAt:      time.Now(),
		HostConnections: make(map[string]bool),
		ReconnectToken:  uuid.New().String(),
	}

	m.sessions.Store(session.ID, session)
	m.tokenToSession.Store(session.ReconnectToken, session.ID)

	log.Printf("[DEBUG] [SESSION] Created new session: %s", session.ID)

	return session
}

// GetSession retrieves a session by ID
func (m *Manager) GetSession(sessionID string) *Session {
	if val, ok := m.sessions.Load(sessionID); ok {
		return val.(*Session)
	}
	return nil
}

// Reconnect attempts to reconnect a session using a reconnect token
// Returns the session if successful, nil if token is invalid or expired
func (m *Manager) Reconnect(reconnectToken string, newConn *websocket.Conn) *Session {
	// Look up session ID from token
	sessionIDVal, ok := m.tokenToSession.Load(reconnectToken)
	if !ok {
		log.Printf("[DEBUG] [SESSION] Reconnect failed: invalid token")
		return nil
	}

	sessionID := sessionIDVal.(string)
	sessionVal, ok := m.sessions.Load(sessionID)
	if !ok {
		log.Printf("[DEBUG] [SESSION] Reconnect failed: session not found")
		m.tokenToSession.Delete(reconnectToken)
		return nil
	}

	session := sessionVal.(*Session)

	// Check if reconnection is still allowed
	if session.State == StateDisconnected {
		if time.Since(session.DisconnectedAt) > m.ReconnectTimeout {
			log.Printf("[DEBUG] [SESSION] Reconnect failed: reconnection timeout exceeded")
			return nil
		}
	}

	// Update session with new connection
	session.mu.Lock()
	if session.Conn != nil {
		session.Conn.Close() // Close old connection if any
	}
	session.Conn = newConn
	session.State = StateConnected
	session.LastSeenAt = time.Now()

	// Generate new reconnect token for security
	oldToken := session.ReconnectToken
	session.ReconnectToken = uuid.New().String()
	session.mu.Unlock()

	// Update token mapping
	m.tokenToSession.Delete(oldToken)
	m.tokenToSession.Store(session.ReconnectToken, session.ID)

	log.Printf("[INFO] [SESSION] Session %s reconnected successfully", session.ID)

	return session
}

// MarkDisconnected marks a session as disconnected but keeps it for potential reconnection
func (m *Manager) MarkDisconnected(sessionID string) {
	if sessionVal, ok := m.sessions.Load(sessionID); ok {
		session := sessionVal.(*Session)
		session.mu.Lock()
		session.State = StateDisconnected
		session.DisconnectedAt = time.Now()
		session.Conn = nil
		session.mu.Unlock()

		log.Printf("[DEBUG] [SESSION] Session %s marked as disconnected", sessionID)
	}
}

// RemoveSession immediately removes a session (no reconnection allowed)
func (m *Manager) RemoveSession(sessionID string) {
	if sessionVal, ok := m.sessions.Load(sessionID); ok {
		session := sessionVal.(*Session)

		// Remove reconnect token mapping
		if session.ReconnectToken != "" {
			m.tokenToSession.Delete(session.ReconnectToken)
		}

		m.sessions.Delete(sessionID)
		log.Printf("[DEBUG] [SESSION] Session %s removed", sessionID)
	}
}

// GetSessionCount returns the total number of sessions (connected + disconnected)
func (m *Manager) GetSessionCount() int {
	count := 0
	m.sessions.Range(func(key, value interface{}) bool {
		count++
		return true
	})
	return count
}

// GetConnectedSessions returns all currently connected sessions
func (m *Manager) GetConnectedSessions() []*Session {
	var sessions []*Session
	m.sessions.Range(func(key, value interface{}) bool {
		session := value.(*Session)
		if session.State == StateConnected {
			sessions = append(sessions, session)
		}
		return true
	})
	return sessions
}

// AddHostConnection records that a session has connected to a host
func (m *Manager) AddHostConnection(sessionID, hostID string) {
	if sessionVal, ok := m.sessions.Load(sessionID); ok {
		session := sessionVal.(*Session)
		session.mu.Lock()
		session.HostConnections[hostID] = true
		session.mu.Unlock()
	}
}

// RemoveHostConnection records that a session has disconnected from a host
func (m *Manager) RemoveHostConnection(sessionID, hostID string) {
	if sessionVal, ok := m.sessions.Load(sessionID); ok {
		session := sessionVal.(*Session)
		session.mu.Lock()
		delete(session.HostConnections, hostID)
		session.mu.Unlock()
	}
}

// GetSessionHostConnections returns the hosts connected by a session
func (m *Manager) GetSessionHostConnections(sessionID string) []string {
	if sessionVal, ok := m.sessions.Load(sessionID); ok {
		session := sessionVal.(*Session)
		session.mu.Lock()
		defer session.mu.Unlock()

		hosts := make([]string, 0, len(session.HostConnections))
		for hostID := range session.HostConnections {
			hosts = append(hosts, hostID)
		}
		return hosts
	}
	return nil
}
