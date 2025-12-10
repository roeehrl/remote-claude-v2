package storage

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"time"
)

// AppendPtyOutput appends PTY output data to a process's history buffer
func (s *Store) AppendPtyOutput(processId, hostId string, data []byte) error {
	if len(data) == 0 {
		return nil
	}

	buf := s.getOrCreatePtyBuffer(processId, hostId)

	buf.mu.Lock()
	defer buf.mu.Unlock()

	chunk := PtyChunk{
		Data:        make([]byte, len(data)),
		SequenceNum: buf.nextSeqNum,
	}
	copy(chunk.Data, data)

	buf.chunks = append(buf.chunks, chunk)
	buf.nextSeqNum++
	buf.totalBytes += int64(len(data))
	buf.dirty = true

	return nil
}

// GetPtyHistory returns all PTY output for a process as a single byte slice
func (s *Store) GetPtyHistory(processId string) ([]byte, error) {
	s.mu.RLock()
	buf, ok := s.ptyBuffers[processId]
	s.mu.RUnlock()

	if !ok {
		// Try loading from database
		return s.getPtyHistoryFromDB(processId)
	}

	buf.mu.RLock()
	defer buf.mu.RUnlock()

	// Calculate total size
	totalSize := int64(0)
	for _, chunk := range buf.chunks {
		totalSize += int64(len(chunk.Data))
	}

	// Concatenate all chunks
	result := make([]byte, 0, totalSize)
	for _, chunk := range buf.chunks {
		result = append(result, chunk.Data...)
	}

	return result, nil
}

// GetPtyHistorySize returns the total size of PTY history for a process
func (s *Store) GetPtyHistorySize(processId string) int64 {
	s.mu.RLock()
	buf, ok := s.ptyBuffers[processId]
	s.mu.RUnlock()

	if !ok {
		return 0
	}

	buf.mu.RLock()
	defer buf.mu.RUnlock()

	return buf.totalBytes
}

// GetPtyHistoryChunked returns PTY history in chunks via a channel
func (s *Store) GetPtyHistoryChunked(processId string, chunkSize int) (<-chan []byte, int, error) {
	history, err := s.GetPtyHistory(processId)
	if err != nil {
		return nil, 0, err
	}

	totalChunks := (len(history) + chunkSize - 1) / chunkSize
	if totalChunks == 0 {
		totalChunks = 1
	}

	ch := make(chan []byte, 10) // Buffered channel

	go func() {
		defer close(ch)

		for i := 0; i < len(history); i += chunkSize {
			end := i + chunkSize
			if end > len(history) {
				end = len(history)
			}
			ch <- history[i:end]
		}

		// Send empty chunk if no data
		if len(history) == 0 {
			ch <- []byte{}
		}
	}()

	return ch, totalChunks, nil
}

// ClearPtyHistory removes all PTY history for a process
func (s *Store) ClearPtyHistory(processId string) error {
	// Clear from memory
	s.mu.Lock()
	delete(s.ptyBuffers, processId)
	s.mu.Unlock()

	// Clear from database
	_, err := s.db.Exec("DELETE FROM pty_history WHERE process_id = ?", processId)
	if err != nil {
		return fmt.Errorf("failed to clear pty history from db: %w", err)
	}

	log.Printf("[DEBUG] [Storage] Cleared PTY history for process %s", processId)
	return nil
}

// persistPtyBuffer saves the PTY buffer to SQLite
func (s *Store) persistPtyBuffer(processId string) error {
	s.mu.RLock()
	buf, ok := s.ptyBuffers[processId]
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
		INSERT OR REPLACE INTO pty_history (process_id, host_id, data, sequence_num, created_at)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, chunk := range buf.chunks {
		_, err := stmt.Exec(processId, hostId, chunk.Data, chunk.SequenceNum, now)
		if err != nil {
			return fmt.Errorf("failed to insert chunk: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	buf.dirty = false
	buf.lastPersist = time.Now()

	return nil
}

// loadPtyHistory loads PTY history from SQLite into memory
func (s *Store) loadPtyHistory(processId, hostId string) error {
	rows, err := s.db.Query(`
		SELECT data, sequence_num FROM pty_history
		WHERE process_id = ?
		ORDER BY sequence_num ASC
	`, processId)
	if err != nil {
		return fmt.Errorf("failed to query pty history: %w", err)
	}
	defer rows.Close()

	buf := s.getOrCreatePtyBuffer(processId, hostId)
	buf.mu.Lock()
	defer buf.mu.Unlock()

	var maxSeq int64 = -1
	for rows.Next() {
		var data []byte
		var seqNum int64
		if err := rows.Scan(&data, &seqNum); err != nil {
			return fmt.Errorf("failed to scan row: %w", err)
		}

		buf.chunks = append(buf.chunks, PtyChunk{
			Data:        data,
			SequenceNum: seqNum,
		})
		buf.totalBytes += int64(len(data))

		if seqNum > maxSeq {
			maxSeq = seqNum
		}
	}

	buf.nextSeqNum = maxSeq + 1
	buf.dirty = false

	return rows.Err()
}

// getPtyHistoryFromDB retrieves PTY history directly from database
func (s *Store) getPtyHistoryFromDB(processId string) ([]byte, error) {
	rows, err := s.db.Query(`
		SELECT data FROM pty_history
		WHERE process_id = ?
		ORDER BY sequence_num ASC
	`, processId)
	if err != nil {
		return nil, fmt.Errorf("failed to query pty history: %w", err)
	}
	defer rows.Close()

	var result []byte
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		result = append(result, data...)
	}

	return result, rows.Err()
}

// CompressPtyData compresses PTY data using gzip
func CompressPtyData(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)

	if _, err := gz.Write(data); err != nil {
		return nil, fmt.Errorf("failed to write gzip: %w", err)
	}

	if err := gz.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip: %w", err)
	}

	return buf.Bytes(), nil
}

// DecompressPtyData decompresses gzip-compressed PTY data
func DecompressPtyData(data []byte) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gz.Close()

	return io.ReadAll(gz)
}

// EncodeBase64 encodes data as base64 string
func EncodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// DecodeBase64 decodes a base64 string
func DecodeBase64(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
