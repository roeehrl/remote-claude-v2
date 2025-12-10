package storage

import (
	"fmt"
	"log"
	"sort"
	"time"
)

// UpsertChatMessage adds or updates a chat message in the buffer
func (s *Store) UpsertChatMessage(processId, hostId string, msg ChatMessage) error {
	buf := s.getOrCreateChatBuffer(processId, hostId)

	buf.mu.Lock()
	defer buf.mu.Unlock()

	buf.messages[msg.MessageID] = msg
	buf.dirty = true

	return nil
}

// GetChatHistory returns all chat messages for a process, ordered by message ID
func (s *Store) GetChatHistory(processId string) ([]ChatMessage, error) {
	s.mu.RLock()
	buf, ok := s.chatBuffers[processId]
	s.mu.RUnlock()

	if !ok {
		// Try loading from database
		return s.getChatHistoryFromDB(processId)
	}

	buf.mu.RLock()
	defer buf.mu.RUnlock()

	// Convert map to sorted slice
	messages := make([]ChatMessage, 0, len(buf.messages))
	for _, msg := range buf.messages {
		messages = append(messages, msg)
	}

	// Sort by message ID (chronological order)
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].MessageID < messages[j].MessageID
	})

	return messages, nil
}

// GetChatMessageCount returns the number of chat messages for a process
func (s *Store) GetChatMessageCount(processId string) int {
	s.mu.RLock()
	buf, ok := s.chatBuffers[processId]
	s.mu.RUnlock()

	if !ok {
		return 0
	}

	buf.mu.RLock()
	defer buf.mu.RUnlock()

	return len(buf.messages)
}

// ClearChatHistory removes all chat history for a process
func (s *Store) ClearChatHistory(processId string) error {
	// Clear from memory
	s.mu.Lock()
	delete(s.chatBuffers, processId)
	s.mu.Unlock()

	// Clear from database
	_, err := s.db.Exec("DELETE FROM chat_history WHERE process_id = ?", processId)
	if err != nil {
		return fmt.Errorf("failed to clear chat history from db: %w", err)
	}

	log.Printf("[DEBUG] [Storage] Cleared chat history for process %s", processId)
	return nil
}

// SetChatMessages replaces all chat messages for a process (used for initial sync)
func (s *Store) SetChatMessages(processId, hostId string, messages []ChatMessage) error {
	buf := s.getOrCreateChatBuffer(processId, hostId)

	buf.mu.Lock()
	defer buf.mu.Unlock()

	// Clear existing and set new
	buf.messages = make(map[int]ChatMessage)
	for _, msg := range messages {
		buf.messages[msg.MessageID] = msg
	}
	buf.dirty = true

	return nil
}

// persistChatBuffer saves the chat buffer to SQLite
func (s *Store) persistChatBuffer(processId string) error {
	s.mu.RLock()
	buf, ok := s.chatBuffers[processId]
	hostId := s.hostMap[processId]
	s.mu.RUnlock()

	if !ok {
		return nil
	}

	buf.mu.Lock()
	defer buf.mu.Unlock()

	if !buf.dirty {
		return nil
	}

	// Use a transaction for batch insert
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO chat_history
		(process_id, host_id, message_id, role, message, message_time, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, msg := range buf.messages {
		_, err := stmt.Exec(
			processId,
			hostId,
			msg.MessageID,
			msg.Role,
			msg.Message,
			msg.MessageTime,
			now,
		)
		if err != nil {
			return fmt.Errorf("failed to insert message: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	buf.dirty = false
	buf.lastPersist = time.Now()

	return nil
}

// loadChatHistory loads chat history from SQLite into memory
func (s *Store) loadChatHistory(processId, hostId string) error {
	rows, err := s.db.Query(`
		SELECT message_id, role, message, message_time FROM chat_history
		WHERE process_id = ?
		ORDER BY message_id ASC
	`, processId)
	if err != nil {
		return fmt.Errorf("failed to query chat history: %w", err)
	}
	defer rows.Close()

	buf := s.getOrCreateChatBuffer(processId, hostId)
	buf.mu.Lock()
	defer buf.mu.Unlock()

	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.MessageID, &msg.Role, &msg.Message, &msg.MessageTime); err != nil {
			return fmt.Errorf("failed to scan row: %w", err)
		}
		buf.messages[msg.MessageID] = msg
	}

	buf.dirty = false

	return rows.Err()
}

// getChatHistoryFromDB retrieves chat history directly from database
func (s *Store) getChatHistoryFromDB(processId string) ([]ChatMessage, error) {
	rows, err := s.db.Query(`
		SELECT message_id, role, message, message_time FROM chat_history
		WHERE process_id = ?
		ORDER BY message_id ASC
	`, processId)
	if err != nil {
		return nil, fmt.Errorf("failed to query chat history: %w", err)
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.MessageID, &msg.Role, &msg.Message, &msg.MessageTime); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

// SyncChatFromAgentAPI syncs chat history from AgentAPI (for initial load or reconnection)
// This is called with messages from AgentAPI's /messages endpoint
func (s *Store) SyncChatFromAgentAPI(processId, hostId string, messages []ChatMessage) error {
	return s.SetChatMessages(processId, hostId, messages)
}
