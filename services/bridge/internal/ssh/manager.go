package ssh

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Connection represents an active SSH connection to a host
type Connection struct {
	ID           string
	Client       *ssh.Client
	Host         string
	Port         int
	Username     string
	mu           sync.Mutex
	lastUsed     time.Time
	connected    bool
	reconnecting bool
}

// Manager manages SSH connections to remote hosts
type Manager struct {
	connections sync.Map // map[hostID]*Connection
	mu          sync.Mutex

	// Timeouts and settings
	DialTimeout      time.Duration
	KeepAliveInterval time.Duration
}

// NewManager creates a new SSH connection manager
func NewManager() *Manager {
	m := &Manager{
		DialTimeout:      30 * time.Second,
		KeepAliveInterval: 30 * time.Second,
	}
	return m
}

// AuthConfig contains SSH authentication configuration
type AuthConfig struct {
	AuthType   string // "password" or "key"
	Password   string
	PrivateKey string
}

// Connect establishes an SSH connection to a remote host
func (m *Manager) Connect(hostID, host string, port int, username string, auth AuthConfig) (*Connection, error) {
	log.Printf("[DEBUG] [SSH] Connecting to %s@%s:%d (hostID=%s)", username, host, port, hostID)

	// Check if connection already exists
	if existingConn := m.GetConnection(hostID); existingConn != nil {
		if existingConn.connected {
			log.Printf("[DEBUG] [SSH] Reusing existing connection for hostID=%s", hostID)
			existingConn.lastUsed = time.Now()
			return existingConn, nil
		}
		// Connection exists but is disconnected, remove it
		m.removeConnection(hostID)
	}

	// Build SSH config
	config, err := m.buildSSHConfig(username, auth)
	if err != nil {
		return nil, fmt.Errorf("failed to build SSH config: %w", err)
	}

	// Dial with timeout
	addr := fmt.Sprintf("%s:%d", host, port)
	log.Printf("[DEBUG] [SSH] Dialing %s...", addr)

	netConn, err := net.DialTimeout("tcp", addr, m.DialTimeout)
	if err != nil {
		log.Printf("[ERROR] [SSH] Failed to dial %s: %v", addr, err)
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	// Perform SSH handshake
	sshConn, chans, reqs, err := ssh.NewClientConn(netConn, addr, config)
	if err != nil {
		netConn.Close()
		log.Printf("[ERROR] [SSH] SSH handshake failed for %s: %v", addr, err)
		return nil, fmt.Errorf("SSH handshake failed: %w", err)
	}

	client := ssh.NewClient(sshConn, chans, reqs)

	conn := &Connection{
		ID:        hostID,
		Client:    client,
		Host:      host,
		Port:      port,
		Username:  username,
		lastUsed:  time.Now(),
		connected: true,
	}

	m.connections.Store(hostID, conn)
	log.Printf("[INFO] [SSH] Connected to %s@%s:%d (hostID=%s)", username, host, port, hostID)

	// Start keepalive goroutine
	go m.keepAlive(conn)

	return conn, nil
}

// buildSSHConfig creates an SSH client config from auth configuration
func (m *Manager) buildSSHConfig(username string, auth AuthConfig) (*ssh.ClientConfig, error) {
	var authMethods []ssh.AuthMethod

	switch auth.AuthType {
	case "password":
		if auth.Password == "" {
			return nil, fmt.Errorf("password is required for password authentication")
		}
		// Add both password and keyboard-interactive methods
		// Many SSH servers use keyboard-interactive instead of plain password
		authMethods = append(authMethods, ssh.Password(auth.Password))
		authMethods = append(authMethods, ssh.KeyboardInteractive(
			func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				// Respond to all questions with the password
				// This handles most keyboard-interactive password prompts
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = auth.Password
				}
				return answers, nil
			},
		))
		log.Printf("[DEBUG] [SSH] Using password + keyboard-interactive authentication")

	case "key":
		if auth.PrivateKey == "" {
			return nil, fmt.Errorf("private key is required for key authentication")
		}
		signer, err := ssh.ParsePrivateKey([]byte(auth.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
		log.Printf("[DEBUG] [SSH] Using private key authentication")

	default:
		return nil, fmt.Errorf("unsupported auth type: %s", auth.AuthType)
	}

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         m.DialTimeout,
	}

	return config, nil
}

// keepAlive sends periodic keepalive requests to keep the connection alive
func (m *Manager) keepAlive(conn *Connection) {
	ticker := time.NewTicker(m.KeepAliveInterval)
	defer ticker.Stop()

	for range ticker.C {
		conn.mu.Lock()
		if !conn.connected {
			conn.mu.Unlock()
			return
		}
		conn.mu.Unlock()

		// Send keepalive request
		_, _, err := conn.Client.SendRequest("keepalive@openssh.com", true, nil)
		if err != nil {
			log.Printf("[WARN] [SSH] Keepalive failed for hostID=%s: %v", conn.ID, err)
			m.markDisconnected(conn.ID)
			return
		}
	}
}

// GetConnection retrieves an existing connection by host ID
func (m *Manager) GetConnection(hostID string) *Connection {
	if val, ok := m.connections.Load(hostID); ok {
		return val.(*Connection)
	}
	return nil
}

// Disconnect closes an SSH connection
func (m *Manager) Disconnect(hostID string) error {
	conn := m.GetConnection(hostID)
	if conn == nil {
		log.Printf("[WARN] [SSH] No connection found for hostID=%s", hostID)
		return nil
	}

	log.Printf("[DEBUG] [SSH] Disconnecting hostID=%s", hostID)

	conn.mu.Lock()
	conn.connected = false
	conn.mu.Unlock()

	if conn.Client != nil {
		if err := conn.Client.Close(); err != nil {
			log.Printf("[WARN] [SSH] Error closing connection for hostID=%s: %v", hostID, err)
		}
	}

	m.connections.Delete(hostID)
	log.Printf("[INFO] [SSH] Disconnected hostID=%s", hostID)

	return nil
}

// markDisconnected marks a connection as disconnected without closing it
func (m *Manager) markDisconnected(hostID string) {
	conn := m.GetConnection(hostID)
	if conn != nil {
		conn.mu.Lock()
		conn.connected = false
		conn.mu.Unlock()
		log.Printf("[DEBUG] [SSH] Marked hostID=%s as disconnected", hostID)
	}
}

// removeConnection removes a connection from the manager
func (m *Manager) removeConnection(hostID string) {
	if conn := m.GetConnection(hostID); conn != nil {
		if conn.Client != nil {
			conn.Client.Close()
		}
		m.connections.Delete(hostID)
	}
}

// IsConnected checks if a connection is active
func (m *Manager) IsConnected(hostID string) bool {
	conn := m.GetConnection(hostID)
	if conn == nil {
		return false
	}
	conn.mu.Lock()
	defer conn.mu.Unlock()
	return conn.connected
}

// GetAllConnections returns all active host IDs
func (m *Manager) GetAllConnections() []string {
	var hostIDs []string
	m.connections.Range(func(key, value interface{}) bool {
		conn := value.(*Connection)
		conn.mu.Lock()
		if conn.connected {
			hostIDs = append(hostIDs, key.(string))
		}
		conn.mu.Unlock()
		return true
	})
	return hostIDs
}

// Close closes all connections and cleans up the manager
func (m *Manager) Close() {
	log.Printf("[INFO] [SSH] Closing all connections")
	m.connections.Range(func(key, value interface{}) bool {
		hostID := key.(string)
		m.Disconnect(hostID)
		return true
	})
}

// CreateSession creates a new SSH session on the connection
func (conn *Connection) CreateSession() (*ssh.Session, error) {
	conn.mu.Lock()
	if !conn.connected {
		conn.mu.Unlock()
		return nil, fmt.Errorf("connection is not active")
	}
	conn.mu.Unlock()

	session, err := conn.Client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	conn.lastUsed = time.Now()
	return session, nil
}

// Dial creates a new connection through the SSH tunnel
func (conn *Connection) Dial(network, addr string) (net.Conn, error) {
	conn.mu.Lock()
	if !conn.connected {
		conn.mu.Unlock()
		return nil, fmt.Errorf("connection is not active")
	}
	conn.mu.Unlock()

	netConn, err := conn.Client.Dial(network, addr)
	if err != nil {
		return nil, fmt.Errorf("failed to dial through SSH tunnel: %w", err)
	}

	conn.lastUsed = time.Now()
	return netConn, nil
}
