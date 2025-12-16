package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS ssh_hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    credential_encrypted BLOB,
    auto_connect INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pty_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    data BLOB NOT NULL,
    sequence_num INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(process_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_pty_history_process ON pty_history(process_id);
CREATE INDEX IF NOT EXISTS idx_pty_history_host ON pty_history(host_id);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    message TEXT NOT NULL,
    message_time TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(process_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_history_process ON chat_history(process_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_host ON chat_history(host_id);

CREATE TABLE IF NOT EXISTS process_metadata (
    process_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    process_type TEXT NOT NULL,
    port INTEGER,
    tmux_name TEXT NOT NULL,
    cwd TEXT,
    name TEXT,
    shell_pid INTEGER,
    agent_api_pid INTEGER,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS host_settings (
    host_id TEXT PRIMARY KEY,
    rc_file_override TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
`

// PtyChunk represents a chunk of PTY output in the buffer
type PtyChunk struct {
	Data        []byte
	SequenceNum int64
}

// ChatMessage represents a cached chat message
type ChatMessage struct {
	MessageID   int    `json:"id"`
	Role        string `json:"role"`
	Message     string `json:"message"`
	MessageTime string `json:"time"`
}

// EnvVar represents an environment variable
type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ProcessMetadata represents saved process state for recovery
type ProcessMetadata struct {
	ProcessID   string
	HostID      string
	ProcessType string
	Port        int
	TmuxName    string
	CWD         string
	Name        string
	ShellPID    int
	AgentAPIPID int
	StartedAt   time.Time
	LastSeenAt  time.Time
	EnvVars     []EnvVar // Environment variables captured at spawn time
}

// PtyBuffer holds in-memory PTY data for a process
type PtyBuffer struct {
	mu          sync.RWMutex
	chunks      []PtyChunk
	nextSeqNum  int64
	dirty       bool // Has unsaved changes
	totalBytes  int64
	lastPersist time.Time
}

// ChatBuffer holds in-memory chat messages for a process
type ChatBuffer struct {
	mu          sync.RWMutex
	messages    map[int]ChatMessage // keyed by message_id
	dirty       bool
	lastPersist time.Time
}

// Store manages SQLite persistence and in-memory buffers
type Store struct {
	db     *sql.DB
	dbPath string

	ptyBuffers  map[string]*PtyBuffer  // processId -> buffer
	chatBuffers map[string]*ChatBuffer // processId -> buffer
	hostMap     map[string]string      // processId -> hostId

	mu     sync.RWMutex
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewStore creates a new storage instance with SQLite backend
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable WAL mode for better concurrent performance
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	// Initialize schema
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	// Migrate schema - add columns that may not exist in older databases
	migrations := []string{
		"ALTER TABLE process_metadata ADD COLUMN cwd TEXT",
		"ALTER TABLE process_metadata ADD COLUMN name TEXT",
		"ALTER TABLE process_metadata ADD COLUMN shell_pid INTEGER",
		"ALTER TABLE process_metadata ADD COLUMN agent_api_pid INTEGER",
		"ALTER TABLE process_metadata ADD COLUMN env_vars TEXT", // JSON blob of env vars
	}
	for _, migration := range migrations {
		// Ignore errors - column may already exist
		db.Exec(migration)
	}

	ctx, cancel := context.WithCancel(context.Background())

	s := &Store{
		db:          db,
		dbPath:      dbPath,
		ptyBuffers:  make(map[string]*PtyBuffer),
		chatBuffers: make(map[string]*ChatBuffer),
		hostMap:     make(map[string]string),
		ctx:         ctx,
		cancel:      cancel,
	}

	// Start periodic persistence goroutine
	s.wg.Add(1)
	go s.persistLoop()

	log.Printf("[INFO] [Storage] Initialized with database: %s", dbPath)
	return s, nil
}

// persistLoop runs periodic persistence every 30 seconds
func (s *Store) persistLoop() {
	defer s.wg.Done()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			log.Printf("[INFO] [Storage] Persistence loop stopping")
			return
		case <-ticker.C:
			if err := s.PersistAll(); err != nil {
				log.Printf("[ERROR] [Storage] Periodic persist failed: %v", err)
			}
		}
	}
}

// PersistAll saves all dirty buffers to SQLite
func (s *Store) PersistAll() error {
	s.mu.RLock()
	processIds := make([]string, 0, len(s.ptyBuffers))
	for pid := range s.ptyBuffers {
		processIds = append(processIds, pid)
	}
	s.mu.RUnlock()

	var errs []error

	for _, pid := range processIds {
		if err := s.persistPtyBuffer(pid); err != nil {
			errs = append(errs, fmt.Errorf("pty %s: %w", pid, err))
		}
		if err := s.persistChatBuffer(pid); err != nil {
			errs = append(errs, fmt.Errorf("chat %s: %w", pid, err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("persist errors: %v", errs)
	}

	log.Printf("[DEBUG] [Storage] Persisted %d process buffers", len(processIds))
	return nil
}

// Close shuts down the store, persisting all data
func (s *Store) Close() error {
	log.Printf("[INFO] [Storage] Closing store...")

	// Signal persistence loop to stop
	s.cancel()

	// Wait for persistence loop to finish
	s.wg.Wait()

	// Final persist
	if err := s.PersistAll(); err != nil {
		log.Printf("[WARN] [Storage] Final persist had errors: %v", err)
	}

	// Close database
	if err := s.db.Close(); err != nil {
		return fmt.Errorf("failed to close database: %w", err)
	}

	log.Printf("[INFO] [Storage] Store closed")
	return nil
}

// getOrCreatePtyBuffer gets or creates a PTY buffer for a process
func (s *Store) getOrCreatePtyBuffer(processId, hostId string) *PtyBuffer {
	s.mu.Lock()
	defer s.mu.Unlock()

	if buf, ok := s.ptyBuffers[processId]; ok {
		return buf
	}

	buf := &PtyBuffer{
		chunks:      make([]PtyChunk, 0),
		nextSeqNum:  0,
		lastPersist: time.Now(),
	}
	s.ptyBuffers[processId] = buf
	s.hostMap[processId] = hostId

	return buf
}

// getOrCreateChatBuffer gets or creates a chat buffer for a process
func (s *Store) getOrCreateChatBuffer(processId, hostId string) *ChatBuffer {
	s.mu.Lock()
	defer s.mu.Unlock()

	if buf, ok := s.chatBuffers[processId]; ok {
		return buf
	}

	buf := &ChatBuffer{
		messages:    make(map[int]ChatMessage),
		lastPersist: time.Now(),
	}
	s.chatBuffers[processId] = buf
	s.hostMap[processId] = hostId

	return buf
}

// RegisterProcess registers a new process for history tracking
func (s *Store) RegisterProcess(processId, hostId string) {
	s.getOrCreatePtyBuffer(processId, hostId)
	s.getOrCreateChatBuffer(processId, hostId)
	log.Printf("[DEBUG] [Storage] Registered process %s for host %s", processId, hostId)
}

// UnregisterProcess removes a process and clears its history
func (s *Store) UnregisterProcess(processId string) error {
	s.mu.Lock()
	delete(s.ptyBuffers, processId)
	delete(s.chatBuffers, processId)
	delete(s.hostMap, processId)
	s.mu.Unlock()

	// Clear from database
	if err := s.ClearPtyHistory(processId); err != nil {
		return err
	}
	if err := s.ClearChatHistory(processId); err != nil {
		return err
	}

	log.Printf("[DEBUG] [Storage] Unregistered process %s", processId)
	return nil
}

// LoadProcessHistory loads history from SQLite into memory buffers
func (s *Store) LoadProcessHistory(processId, hostId string) error {
	// Load PTY history
	if err := s.loadPtyHistory(processId, hostId); err != nil {
		return fmt.Errorf("failed to load pty history: %w", err)
	}

	// Load chat history
	if err := s.loadChatHistory(processId, hostId); err != nil {
		return fmt.Errorf("failed to load chat history: %w", err)
	}

	log.Printf("[DEBUG] [Storage] Loaded history for process %s", processId)
	return nil
}

// ============================================================================
// Process Metadata Methods
// ============================================================================

// SaveProcessMetadata saves or updates process metadata
func (s *Store) SaveProcessMetadata(meta ProcessMetadata) error {
	// Serialize env vars to JSON
	var envVarsJSON *string
	if len(meta.EnvVars) > 0 {
		data, err := json.Marshal(meta.EnvVars)
		if err != nil {
			log.Printf("[WARN] [Storage] Failed to marshal env vars: %v", err)
		} else {
			str := string(data)
			envVarsJSON = &str
		}
	}

	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO process_metadata
		(process_id, host_id, process_type, port, tmux_name, cwd, name, shell_pid, agent_api_pid, started_at, last_seen_at, env_vars)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ProcessID,
		meta.HostID,
		meta.ProcessType,
		nullInt(meta.Port),
		meta.TmuxName,
		nullString(meta.CWD),
		nullString(meta.Name),
		nullInt(meta.ShellPID),
		nullInt(meta.AgentAPIPID),
		meta.StartedAt.Unix(),
		time.Now().Unix(),
		envVarsJSON,
	)
	if err != nil {
		return fmt.Errorf("failed to save process metadata: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Saved metadata for process %s (type=%s, port=%d, envVars=%d)", meta.ProcessID, meta.ProcessType, meta.Port, len(meta.EnvVars))
	return nil
}

// nullInt returns nil if v is 0, otherwise returns v
func nullInt(v int) interface{} {
	if v == 0 {
		return nil
	}
	return v
}

// nullString returns nil if v is empty, otherwise returns v
func nullString(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}

// GetProcessMetadata retrieves metadata for a specific process
func (s *Store) GetProcessMetadata(processID string) (*ProcessMetadata, error) {
	row := s.db.QueryRow(`
		SELECT process_id, host_id, process_type, port, tmux_name, cwd, name, shell_pid, agent_api_pid, started_at, last_seen_at, env_vars
		FROM process_metadata WHERE process_id = ?`, processID)

	var meta ProcessMetadata
	var port, shellPID, agentAPIPID sql.NullInt64
	var cwd, name, envVarsJSON sql.NullString
	var startedAt, lastSeenAt int64

	err := row.Scan(&meta.ProcessID, &meta.HostID, &meta.ProcessType, &port, &meta.TmuxName, &cwd, &name, &shellPID, &agentAPIPID, &startedAt, &lastSeenAt, &envVarsJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get process metadata: %w", err)
	}

	if port.Valid {
		meta.Port = int(port.Int64)
	}
	if cwd.Valid {
		meta.CWD = cwd.String
	}
	if name.Valid {
		meta.Name = name.String
	}
	if shellPID.Valid {
		meta.ShellPID = int(shellPID.Int64)
	}
	if agentAPIPID.Valid {
		meta.AgentAPIPID = int(agentAPIPID.Int64)
	}
	meta.StartedAt = time.Unix(startedAt, 0)
	meta.LastSeenAt = time.Unix(lastSeenAt, 0)

	// Parse env vars JSON
	if envVarsJSON.Valid && envVarsJSON.String != "" {
		if err := json.Unmarshal([]byte(envVarsJSON.String), &meta.EnvVars); err != nil {
			log.Printf("[WARN] [Storage] Failed to unmarshal env vars for process %s: %v", processID, err)
		}
	}

	return &meta, nil
}

// GetProcessMetadataByHost retrieves all process metadata for a host
func (s *Store) GetProcessMetadataByHost(hostID string) ([]ProcessMetadata, error) {
	rows, err := s.db.Query(`
		SELECT process_id, host_id, process_type, port, tmux_name, cwd, name, shell_pid, agent_api_pid, started_at, last_seen_at, env_vars
		FROM process_metadata WHERE host_id = ?`, hostID)
	if err != nil {
		return nil, fmt.Errorf("failed to query process metadata: %w", err)
	}
	defer rows.Close()

	var results []ProcessMetadata
	for rows.Next() {
		var meta ProcessMetadata
		var port, shellPID, agentAPIPID sql.NullInt64
		var cwd, name, envVarsJSON sql.NullString
		var startedAt, lastSeenAt int64

		if err := rows.Scan(&meta.ProcessID, &meta.HostID, &meta.ProcessType, &port, &meta.TmuxName, &cwd, &name, &shellPID, &agentAPIPID, &startedAt, &lastSeenAt, &envVarsJSON); err != nil {
			return nil, fmt.Errorf("failed to scan process metadata: %w", err)
		}

		if port.Valid {
			meta.Port = int(port.Int64)
		}
		if cwd.Valid {
			meta.CWD = cwd.String
		}
		if name.Valid {
			meta.Name = name.String
		}
		if shellPID.Valid {
			meta.ShellPID = int(shellPID.Int64)
		}
		if agentAPIPID.Valid {
			meta.AgentAPIPID = int(agentAPIPID.Int64)
		}
		meta.StartedAt = time.Unix(startedAt, 0)
		meta.LastSeenAt = time.Unix(lastSeenAt, 0)

		// Parse env vars JSON
		if envVarsJSON.Valid && envVarsJSON.String != "" {
			if err := json.Unmarshal([]byte(envVarsJSON.String), &meta.EnvVars); err != nil {
				log.Printf("[WARN] [Storage] Failed to unmarshal env vars for process %s: %v", meta.ProcessID, err)
			}
		}

		results = append(results, meta)
	}

	return results, nil
}

// DeleteProcessMetadata removes metadata for a process
func (s *Store) DeleteProcessMetadata(processID string) error {
	_, err := s.db.Exec(`DELETE FROM process_metadata WHERE process_id = ?`, processID)
	if err != nil {
		return fmt.Errorf("failed to delete process metadata: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Deleted metadata for process %s", processID)
	return nil
}

// UpdateProcessType updates the type and port of a process
func (s *Store) UpdateProcessType(processID string, processType string, port int) error {
	_, err := s.db.Exec(`
		UPDATE process_metadata
		SET process_type = ?, port = ?, last_seen_at = ?
		WHERE process_id = ?`,
		processType, port, time.Now().Unix(), processID)
	if err != nil {
		return fmt.Errorf("failed to update process type: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Updated process %s to type=%s, port=%d", processID, processType, port)
	return nil
}

// UpdateProcessName updates the name of a process
func (s *Store) UpdateProcessName(processID string, name string) error {
	_, err := s.db.Exec(`
		UPDATE process_metadata
		SET name = ?, last_seen_at = ?
		WHERE process_id = ?`,
		name, time.Now().Unix(), processID)
	if err != nil {
		return fmt.Errorf("failed to update process name: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Updated process %s name to %q", processID, name)
	return nil
}

// UpdateProcessEnvVars updates the environment variables for a process
func (s *Store) UpdateProcessEnvVars(processID string, envVars []EnvVar) error {
	var envVarsJSON *string
	if len(envVars) > 0 {
		data, err := json.Marshal(envVars)
		if err != nil {
			return fmt.Errorf("failed to marshal env vars: %w", err)
		}
		str := string(data)
		envVarsJSON = &str
	}

	_, err := s.db.Exec(`
		UPDATE process_metadata
		SET env_vars = ?, last_seen_at = ?
		WHERE process_id = ?`,
		envVarsJSON, time.Now().Unix(), processID)
	if err != nil {
		return fmt.Errorf("failed to update process env vars: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Updated process %s with %d env vars", processID, len(envVars))
	return nil
}

// ============================================================================
// Host Settings Methods
// ============================================================================

// GetHostRcFile returns the RC file override for a host, or empty string if not set
func (s *Store) GetHostRcFile(hostID string) (string, error) {
	var rcFile sql.NullString
	err := s.db.QueryRow(`SELECT rc_file_override FROM host_settings WHERE host_id = ?`, hostID).Scan(&rcFile)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get host rc file: %w", err)
	}
	if rcFile.Valid {
		return rcFile.String, nil
	}
	return "", nil
}

// SetHostRcFile saves the RC file override for a host
func (s *Store) SetHostRcFile(hostID, rcFile string) error {
	_, err := s.db.Exec(`
		INSERT INTO host_settings (host_id, rc_file_override, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(host_id) DO UPDATE SET rc_file_override = ?, updated_at = ?`,
		hostID, rcFile, time.Now().Unix(), rcFile, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("failed to set host rc file: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Set RC file for host %s to %q", hostID, rcFile)
	return nil
}

// DeleteHostSettings removes settings for a host
func (s *Store) DeleteHostSettings(hostID string) error {
	_, err := s.db.Exec(`DELETE FROM host_settings WHERE host_id = ?`, hostID)
	if err != nil {
		return fmt.Errorf("failed to delete host settings: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Deleted settings for host %s", hostID)
	return nil
}

// ============================================================================
// SSH Host Configuration Methods
// ============================================================================

// SSHHost represents a stored SSH host configuration
type SSHHost struct {
	ID                  string
	Name                string
	Host                string
	Port                int
	Username            string
	AuthType            string // "password" or "key"
	CredentialEncrypted []byte // encrypted password or private key
	AutoConnect         bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// CreateSSHHost creates a new SSH host configuration
func (s *Store) CreateSSHHost(host SSHHost) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO ssh_hosts (id, name, host, port, username, auth_type, credential_encrypted, auto_connect, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Name, host.Host, host.Port, host.Username, host.AuthType,
		host.CredentialEncrypted, boolToInt(host.AutoConnect), now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to create SSH host: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Created SSH host %s (%s)", host.ID, host.Name)
	return nil
}

// GetSSHHost retrieves a specific SSH host by ID
func (s *Store) GetSSHHost(id string) (*SSHHost, error) {
	row := s.db.QueryRow(`
		SELECT id, name, host, port, username, auth_type, credential_encrypted, auto_connect, created_at, updated_at
		FROM ssh_hosts WHERE id = ?`, id)

	var host SSHHost
	var autoConnect int
	var createdAt, updatedAt int64

	err := row.Scan(&host.ID, &host.Name, &host.Host, &host.Port, &host.Username,
		&host.AuthType, &host.CredentialEncrypted, &autoConnect, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get SSH host: %w", err)
	}

	host.AutoConnect = autoConnect != 0
	host.CreatedAt = time.Unix(createdAt, 0)
	host.UpdatedAt = time.Unix(updatedAt, 0)

	return &host, nil
}

// ListSSHHosts returns all configured SSH hosts
func (s *Store) ListSSHHosts() ([]SSHHost, error) {
	rows, err := s.db.Query(`
		SELECT id, name, host, port, username, auth_type, credential_encrypted, auto_connect, created_at, updated_at
		FROM ssh_hosts ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("failed to list SSH hosts: %w", err)
	}
	defer rows.Close()

	var hosts []SSHHost
	for rows.Next() {
		var host SSHHost
		var autoConnect int
		var createdAt, updatedAt int64

		if err := rows.Scan(&host.ID, &host.Name, &host.Host, &host.Port, &host.Username,
			&host.AuthType, &host.CredentialEncrypted, &autoConnect, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan SSH host: %w", err)
		}

		host.AutoConnect = autoConnect != 0
		host.CreatedAt = time.Unix(createdAt, 0)
		host.UpdatedAt = time.Unix(updatedAt, 0)
		hosts = append(hosts, host)
	}

	return hosts, nil
}

// UpdateSSHHost updates an existing SSH host configuration
func (s *Store) UpdateSSHHost(host SSHHost) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		UPDATE ssh_hosts
		SET name = ?, host = ?, port = ?, username = ?, auth_type = ?, credential_encrypted = ?, auto_connect = ?, updated_at = ?
		WHERE id = ?`,
		host.Name, host.Host, host.Port, host.Username, host.AuthType,
		host.CredentialEncrypted, boolToInt(host.AutoConnect), now, host.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update SSH host: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Updated SSH host %s (%s)", host.ID, host.Name)
	return nil
}

// DeleteSSHHost removes an SSH host configuration
func (s *Store) DeleteSSHHost(id string) error {
	_, err := s.db.Exec(`DELETE FROM ssh_hosts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete SSH host: %w", err)
	}
	// Also delete associated host settings
	s.DeleteHostSettings(id)
	log.Printf("[DEBUG] [Storage] Deleted SSH host %s", id)
	return nil
}

// boolToInt converts bool to int for SQLite
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ============================================================================
// Snippet Methods
// ============================================================================

// Snippet represents a command snippet for quick terminal access
type Snippet struct {
	ID        string
	Name      string
	Content   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CreateSnippet creates a new snippet
func (s *Store) CreateSnippet(snippet Snippet) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO snippets (id, name, content, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`,
		snippet.ID, snippet.Name, snippet.Content, now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to create snippet: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Created snippet %s (%s)", snippet.ID, snippet.Name)
	return nil
}

// GetSnippet retrieves a specific snippet by ID
func (s *Store) GetSnippet(id string) (*Snippet, error) {
	row := s.db.QueryRow(`
		SELECT id, name, content, created_at, updated_at
		FROM snippets WHERE id = ?`, id)

	var snippet Snippet
	var createdAt, updatedAt int64

	err := row.Scan(&snippet.ID, &snippet.Name, &snippet.Content, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get snippet: %w", err)
	}

	snippet.CreatedAt = time.Unix(createdAt, 0)
	snippet.UpdatedAt = time.Unix(updatedAt, 0)

	return &snippet, nil
}

// ListSnippets returns all snippets ordered by name
func (s *Store) ListSnippets() ([]Snippet, error) {
	rows, err := s.db.Query(`
		SELECT id, name, content, created_at, updated_at
		FROM snippets ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("failed to list snippets: %w", err)
	}
	defer rows.Close()

	var snippets []Snippet
	for rows.Next() {
		var snippet Snippet
		var createdAt, updatedAt int64

		if err := rows.Scan(&snippet.ID, &snippet.Name, &snippet.Content, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan snippet: %w", err)
		}

		snippet.CreatedAt = time.Unix(createdAt, 0)
		snippet.UpdatedAt = time.Unix(updatedAt, 0)
		snippets = append(snippets, snippet)
	}

	return snippets, nil
}

// UpdateSnippet updates an existing snippet
func (s *Store) UpdateSnippet(snippet Snippet) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		UPDATE snippets
		SET name = ?, content = ?, updated_at = ?
		WHERE id = ?`,
		snippet.Name, snippet.Content, now, snippet.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update snippet: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Updated snippet %s (%s)", snippet.ID, snippet.Name)
	return nil
}

// DeleteSnippet removes a snippet
func (s *Store) DeleteSnippet(id string) error {
	_, err := s.db.Exec(`DELETE FROM snippets WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete snippet: %w", err)
	}
	log.Printf("[DEBUG] [Storage] Deleted snippet %s", id)
	return nil
}
