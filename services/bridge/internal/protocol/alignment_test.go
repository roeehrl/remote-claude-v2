package protocol

import (
	"encoding/json"
	"testing"
)

// TestMessageTypeAlignment verifies that Go message type constants match TypeScript
// These values are copied from packages/shared-types/src/messages.ts
func TestMessageTypeAlignment(t *testing.T) {
	expectedTypes := map[string]string{
		// Authentication
		"AUTH":        "auth",
		"AUTH_RESULT": "auth_result",

		// Host Management
		"HOST_CONNECT":    "host_connect",
		"HOST_DISCONNECT": "host_disconnect",
		"HOST_STATUS":     "host_status",

		// Process Management
		"PROCESS_LIST":        "process_list",
		"PROCESS_LIST_RESULT": "process_list_result",
		"PROCESS_CREATE":      "process_create",
		"PROCESS_CREATED":     "process_created",
		"PROCESS_SELECT":      "process_select",
		"PROCESS_KILL":        "process_kill",
		"PROCESS_KILLED":      "process_killed",
		"PROCESS_UPDATED":     "process_updated",

		// Claude Conversion
		"CLAUDE_START": "claude_start",
		"CLAUDE_KILL":  "claude_kill",

		// PTY (Terminal)
		"PTY_INPUT":            "pty_input",
		"PTY_OUTPUT":           "pty_output",
		"PTY_RESIZE":           "pty_resize",
		"PTY_HISTORY_REQUEST":  "pty_history_request",
		"PTY_HISTORY_RESPONSE": "pty_history_response",
		"PTY_HISTORY_CHUNK":    "pty_history_chunk",
		"PTY_HISTORY_COMPLETE": "pty_history_complete",

		// Chat (AgentAPI)
		"CHAT_SUBSCRIBE":     "chat_subscribe",
		"CHAT_UNSUBSCRIBE":   "chat_unsubscribe",
		"CHAT_SEND":          "chat_send",
		"CHAT_RAW":           "chat_raw",
		"CHAT_EVENT":         "chat_event",
		"CHAT_STATUS":        "chat_status",
		"CHAT_STATUS_RESULT": "chat_status_result",
		"CHAT_HISTORY":       "chat_history",
		"CHAT_MESSAGES":      "chat_messages",

		// Error
		"ERROR": "error",
	}

	// Verify Go constants match expected values
	goConstants := map[string]string{
		"AUTH":               TypeAuth,
		"AUTH_RESULT":        TypeAuthResult,
		"HOST_CONNECT":       TypeHostConnect,
		"HOST_DISCONNECT":    TypeHostDisconnect,
		"HOST_STATUS":        TypeHostStatus,
		"PROCESS_LIST":        TypeProcessList,
		"PROCESS_LIST_RESULT": TypeProcessListResult,
		"PROCESS_CREATE":      TypeProcessCreate,
		"PROCESS_CREATED":     TypeProcessCreated,
		"PROCESS_SELECT":      TypeProcessSelect,
		"PROCESS_KILL":        TypeProcessKill,
		"PROCESS_KILLED":      TypeProcessKilled,
		"PROCESS_UPDATED":     TypeProcessUpdated,
		"CLAUDE_START":       TypeClaudeStart,
		"CLAUDE_KILL":        TypeClaudeKill,
		"PTY_INPUT":            TypePtyInput,
		"PTY_OUTPUT":           TypePtyOutput,
		"PTY_RESIZE":           TypePtyResize,
		"PTY_HISTORY_REQUEST":  TypePtyHistoryRequest,
		"PTY_HISTORY_RESPONSE": TypePtyHistoryResponse,
		"PTY_HISTORY_CHUNK":    TypePtyHistoryChunk,
		"PTY_HISTORY_COMPLETE": TypePtyHistoryComplete,
		"CHAT_SUBSCRIBE":     TypeChatSubscribe,
		"CHAT_UNSUBSCRIBE":   TypeChatUnsubscribe,
		"CHAT_SEND":          TypeChatSend,
		"CHAT_RAW":           TypeChatRaw,
		"CHAT_EVENT":         TypeChatEvent,
		"CHAT_STATUS":        TypeChatStatus,
		"CHAT_STATUS_RESULT": TypeChatStatusResult,
		"CHAT_HISTORY":       TypeChatHistory,
		"CHAT_MESSAGES":      TypeChatMessages,
		"ERROR":              TypeError,
	}

	for name, expected := range expectedTypes {
		got, ok := goConstants[name]
		if !ok {
			t.Errorf("Missing Go constant for %s", name)
			continue
		}
		if got != expected {
			t.Errorf("Message type mismatch for %s: Go has %q, TS expects %q", name, got, expected)
		}
	}

	// Check we have all types
	if len(goConstants) != len(expectedTypes) {
		t.Errorf("Type count mismatch: Go has %d, TS expects %d", len(goConstants), len(expectedTypes))
	}
}

// TestPayloadJSONFieldAlignment verifies JSON field names match TypeScript interfaces
func TestPayloadJSONFieldAlignment(t *testing.T) {
	token := "test-token"
	sessionID := "session-123"

	tests := []struct {
		name           string
		payload        interface{}
		expectedFields []string
	}{
		{
			name: "AuthPayload",
			payload: AuthPayload{
				ReconnectToken: &token,
			},
			expectedFields: []string{"reconnectToken"},
		},
		{
			name: "AuthResultPayload",
			payload: AuthResultPayload{
				Success:        true,
				SessionID:      &sessionID,
				ReconnectToken: &token,
				Reconnected:    false,
			},
			expectedFields: []string{"success", "sessionId", "reconnectToken", "reconnected"},
		},
		{
			name: "ProcessInfo",
			payload: ProcessInfo{
				ID:            "test-id",
				Type:          ProcessTypeShell,
				HostID:        "host-id",
				CWD:           "/home",
				PtyReady:      true,
				AgentAPIReady: false,
				StartedAt:     "2024-01-01T00:00:00Z",
			},
			expectedFields: []string{"id", "type", "hostId", "cwd", "ptyReady", "agentApiReady", "startedAt"},
		},
		{
			name: "HostConnectPayload",
			payload: HostConnectPayload{
				HostID:   "host-id",
				Host:     "192.168.1.1",
				Port:     22,
				Username: "user",
				AuthType: "password",
			},
			expectedFields: []string{"hostId", "host", "port", "username", "authType"},
		},
		{
			name: "ProcessCreatePayload",
			payload: ProcessCreatePayload{
				HostID: "host-id",
			},
			expectedFields: []string{"hostId"},
		},
		{
			name: "PtyInputPayload",
			payload: PtyInputPayload{
				ProcessID: "proc-id",
				Data:      "ls -la\n",
			},
			expectedFields: []string{"processId", "data"},
		},
		{
			name: "ChatSendPayload",
			payload: ChatSendPayload{
				HostID:    "host-id",
				ProcessID: "proc-id",
				Content:   "Hello",
			},
			expectedFields: []string{"hostId", "processId", "content"},
		},
		{
			name: "ProcessUpdatedPayload",
			payload: ProcessUpdatedPayload{
				ID:            "proc-id",
				Type:          ProcessTypeClaude,
				PtyReady:      true,
				AgentAPIReady: true,
			},
			expectedFields: []string{"id", "type", "ptyReady", "agentApiReady"},
		},
		{
			name: "PtyHistoryRequestPayload",
			payload: PtyHistoryRequestPayload{
				ProcessID: "proc-id",
			},
			expectedFields: []string{"processId"},
		},
		{
			name: "PtyHistoryResponsePayload",
			payload: PtyHistoryResponsePayload{
				ProcessID:  "proc-id",
				TotalSize:  1024,
				Compressed: false,
			},
			expectedFields: []string{"processId", "totalSize", "compressed"},
		},
		{
			name: "PtyHistoryChunkPayload",
			payload: PtyHistoryChunkPayload{
				ProcessID:   "proc-id",
				Data:        "base64data",
				ChunkIndex:  0,
				TotalChunks: 1,
				IsLast:      true,
			},
			expectedFields: []string{"processId", "data", "chunkIndex", "totalChunks", "isLast"},
		},
		{
			name: "PtyHistoryCompletePayload",
			payload: PtyHistoryCompletePayload{
				ProcessID: "proc-id",
				Success:   true,
			},
			expectedFields: []string{"processId", "success"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("Failed to marshal %s: %v", tt.name, err)
			}

			var result map[string]interface{}
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatalf("Failed to unmarshal %s: %v", tt.name, err)
			}

			for _, field := range tt.expectedFields {
				if _, ok := result[field]; !ok {
					t.Errorf("%s: missing expected field %q", tt.name, field)
				}
			}
		})
	}
}

// TestBidirectionalParsing verifies Go can parse messages from TypeScript format
func TestBidirectionalParsing(t *testing.T) {
	// Simulate a message that would come from TypeScript
	tsMessage := `{
		"type": "process_create",
		"payload": {"hostId": "host-123", "cwd": "/home/user"},
		"timestamp": 1704067200000
	}`

	var msg Message
	if err := json.Unmarshal([]byte(tsMessage), &msg); err != nil {
		t.Fatalf("Failed to parse TS message: %v", err)
	}

	if msg.Type != TypeProcessCreate {
		t.Errorf("Type mismatch: got %q, want %q", msg.Type, TypeProcessCreate)
	}

	var payload ProcessCreatePayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		t.Fatalf("Failed to parse payload: %v", err)
	}

	if payload.HostID != "host-123" {
		t.Errorf("HostID mismatch: got %q, want %q", payload.HostID, "host-123")
	}

	cwd := "/home/user"
	if payload.CWD == nil || *payload.CWD != cwd {
		t.Errorf("CWD mismatch: got %v, want %q", payload.CWD, cwd)
	}
}

// TestProcessTypeValues verifies process type string values match TypeScript
func TestProcessTypeValues(t *testing.T) {
	if string(ProcessTypeShell) != "shell" {
		t.Errorf("ProcessTypeShell mismatch: got %q, want %q", ProcessTypeShell, "shell")
	}
	if string(ProcessTypeClaude) != "claude" {
		t.Errorf("ProcessTypeClaude mismatch: got %q, want %q", ProcessTypeClaude, "claude")
	}
}
