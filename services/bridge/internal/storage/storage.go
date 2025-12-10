package storage

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
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
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
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

// ProcessMetadata represents saved process state for recovery
type ProcessMetadata struct {
	ProcessID   string
	HostID      string
	ProcessType string
	Port        int
	TmuxName    string
	StartedAt   time.Time
	LastSeenAt  time.Time
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
