package protocol

import (
	"encoding/json"
	"time"
)

// MessageType constants - MUST match TypeScript MessageTypes exactly
const (
	// Authentication
	TypeAuth       = "auth"
	TypeAuthResult = "auth_result"

	// Host Configuration (CRUD - stored in bridge)
	TypeHostConfigList         = "host_config_list"
	TypeHostConfigListResult   = "host_config_list_result"
	TypeHostConfigCreate       = "host_config_create"
	TypeHostConfigCreateResult = "host_config_create_result"
	TypeHostConfigUpdate       = "host_config_update"
	TypeHostConfigUpdateResult = "host_config_update_result"
	TypeHostConfigDelete       = "host_config_delete"
	TypeHostConfigDeleteResult = "host_config_delete_result"

	// Host Connection (runtime)
	TypeHostConnect            = "host_connect"
	TypeHostDisconnect         = "host_disconnect"
	TypeHostStatus             = "host_status"
	TypeHostCheckRequirements  = "host_check_requirements"
	TypeHostRequirementsResult = "host_requirements_result"

	// Process Management
	TypeProcessList       = "process_list"
	TypeProcessListResult = "process_list_result"
	TypeProcessCreate     = "process_create"
	TypeProcessCreated    = "process_created"
	TypeProcessSelect     = "process_select"
	TypeProcessKill       = "process_kill"
	TypeProcessKilled     = "process_killed"
	TypeProcessUpdated    = "process_updated"
	TypeProcessReattach   = "process_reattach"
	TypeProcessRename     = "process_rename"

	// Claude Conversion
	TypeClaudeStart = "claude_start"
	TypeClaudeKill  = "claude_kill"

	// PTY (Terminal)
	TypePtyInput  = "pty_input"
	TypePtyOutput = "pty_output"
	TypePtyResize = "pty_resize"

	// PTY History
	TypePtyHistoryRequest  = "pty_history_request"
	TypePtyHistoryResponse = "pty_history_response"
	TypePtyHistoryChunk    = "pty_history_chunk"
	TypePtyHistoryComplete = "pty_history_complete"

	// Chat (AgentAPI)
	TypeChatSubscribe    = "chat_subscribe"
	TypeChatUnsubscribe  = "chat_unsubscribe"
	TypeChatSend         = "chat_send"
	TypeChatRaw          = "chat_raw"
	TypeChatEvent        = "chat_event"
	TypeChatStatus       = "chat_status"
	TypeChatStatusResult = "chat_status_result"
	TypeChatHistory      = "chat_history"
	TypeChatMessages     = "chat_messages"

	// Environment Variables - Host Level
	TypeEnvList      = "env_list"
	TypeEnvUpdate    = "env_update"
	TypeEnvResult    = "env_result"
	TypeEnvSetRcFile = "env_set_rc_file"

	// Environment Variables - Process Level
	TypeProcessEnvList   = "process_env_list"
	TypeProcessEnvResult = "process_env_result"

	// Ports Scanning
	TypePortsScan   = "ports_scan"
	TypePortsResult = "ports_result"

	// Snippets (global, unrelated to hosts/processes)
	TypeSnippetList         = "snippet_list"
	TypeSnippetListResult   = "snippet_list_result"
	TypeSnippetCreate       = "snippet_create"
	TypeSnippetCreateResult = "snippet_create_result"
	TypeSnippetUpdate       = "snippet_update"
	TypeSnippetUpdateResult = "snippet_update_result"
	TypeSnippetDelete       = "snippet_delete"
	TypeSnippetDeleteResult = "snippet_delete_result"

	// Error
	TypeError = "error"
)

// AllMessageTypes returns all message type constants for alignment testing
func AllMessageTypes() []string {
	return []string{
		TypeAuth, TypeAuthResult,
		TypeHostConfigList, TypeHostConfigListResult, TypeHostConfigCreate, TypeHostConfigCreateResult,
		TypeHostConfigUpdate, TypeHostConfigUpdateResult, TypeHostConfigDelete, TypeHostConfigDeleteResult,
		TypeHostConnect, TypeHostDisconnect, TypeHostStatus, TypeHostCheckRequirements, TypeHostRequirementsResult,
		TypeProcessList, TypeProcessListResult, TypeProcessCreate, TypeProcessCreated,
		TypeProcessSelect, TypeProcessKill, TypeProcessKilled, TypeProcessUpdated, TypeProcessReattach, TypeProcessRename,
		TypeClaudeStart, TypeClaudeKill,
		TypePtyInput, TypePtyOutput, TypePtyResize,
		TypePtyHistoryRequest, TypePtyHistoryResponse, TypePtyHistoryChunk, TypePtyHistoryComplete,
		TypeChatSubscribe, TypeChatUnsubscribe, TypeChatSend, TypeChatRaw,
		TypeChatEvent, TypeChatStatus, TypeChatStatusResult, TypeChatHistory, TypeChatMessages,
		TypeEnvList, TypeEnvUpdate, TypeEnvResult, TypeEnvSetRcFile,
		TypeProcessEnvList, TypeProcessEnvResult,
		TypePortsScan, TypePortsResult,
		TypeSnippetList, TypeSnippetListResult, TypeSnippetCreate, TypeSnippetCreateResult,
		TypeSnippetUpdate, TypeSnippetUpdateResult, TypeSnippetDelete, TypeSnippetDeleteResult,
		TypeError,
	}
}

// ============================================================================
// Base Message
// ============================================================================

// Message is the base WebSocket message wrapper
type Message struct {
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

// NewMessage creates a new message with the current timestamp
func NewMessage(msgType string, payload interface{}) (*Message, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return &Message{
		Type:      msgType,
		Payload:   data,
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// ============================================================================
// Process Types
// ============================================================================

type ProcessType string

const (
	ProcessTypeShell  ProcessType = "shell"
	ProcessTypeClaude ProcessType = "claude"
)

// ProcessInfo represents a running process
type ProcessInfo struct {
	ID            string      `json:"id"`
	Type          ProcessType `json:"type"`
	HostID        string      `json:"hostId"`
	Port          *int        `json:"port,omitempty"`
	CWD           string      `json:"cwd"`
	Name          *string     `json:"name,omitempty"` // Custom user-defined name
	PtyReady      bool        `json:"ptyReady"`
	AgentAPIReady bool        `json:"agentApiReady"`
	StartedAt     string      `json:"startedAt"` // ISO timestamp
	ShellPID      *int        `json:"shellPid,omitempty"`
	AgentAPIPID   *int        `json:"agentApiPid,omitempty"`
}

// StaleProcess represents a detected but not connected process
// Can be either an orphaned AgentAPI port or a detached tmux session
type StaleProcess struct {
	Port        int     `json:"port,omitempty"`        // AgentAPI port (if applicable)
	Reason      string  `json:"reason"`                // "connection_refused", "timeout", "detached"
	TmuxSession *string `json:"tmuxSession,omitempty"` // tmux session name (for reattach)
	ProcessID   *string `json:"processId,omitempty"`   // Process ID extracted from tmux name
	StartedAt   *string `json:"startedAt,omitempty"`   // When the session was created
}

// ============================================================================
// Authentication Payloads
// ============================================================================

type AuthPayload struct {
	ReconnectToken *string `json:"reconnectToken,omitempty"` // Optional token for reconnection
}

type AuthResultPayload struct {
	Success        bool    `json:"success"`
	SessionID      *string `json:"sessionId,omitempty"`
	ReconnectToken *string `json:"reconnectToken,omitempty"` // Token to use for reconnection
	Reconnected    bool    `json:"reconnected"`              // Whether this was a reconnection
	Error          *string `json:"error,omitempty"`
}

// ============================================================================
// Host Configuration Payloads (CRUD - stored in bridge)
// ============================================================================

// SSHHostConfig represents a stored SSH host configuration
type SSHHostConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	AuthType    string `json:"authType"` // "password" or "key"
	AutoConnect bool   `json:"autoConnect"`
	CreatedAt   string `json:"createdAt"` // ISO timestamp
	UpdatedAt   string `json:"updatedAt"` // ISO timestamp
	// Note: credentials are NOT included in responses for security
}

type HostConfigListPayload struct {
	// empty - no params needed
}

type HostConfigListResultPayload struct {
	Hosts []SSHHostConfig `json:"hosts"`
}

type HostConfigCreatePayload struct {
	Name        string  `json:"name"`
	Host        string  `json:"host"`
	Port        int     `json:"port"`
	Username    string  `json:"username"`
	AuthType    string  `json:"authType"`   // "password" or "key"
	Credential  string  `json:"credential"` // password or private key
	AutoConnect *bool   `json:"autoConnect,omitempty"`
}

type HostConfigCreateResultPayload struct {
	Success bool           `json:"success"`
	Host    *SSHHostConfig `json:"host,omitempty"`
	Error   *string        `json:"error,omitempty"`
}

type HostConfigUpdatePayload struct {
	ID          string  `json:"id"`
	Name        *string `json:"name,omitempty"`
	Host        *string `json:"host,omitempty"`
	Port        *int    `json:"port,omitempty"`
	Username    *string `json:"username,omitempty"`
	AuthType    *string `json:"authType,omitempty"`
	Credential  *string `json:"credential,omitempty"` // only set if changing credential
	AutoConnect *bool   `json:"autoConnect,omitempty"`
}

type HostConfigUpdateResultPayload struct {
	Success bool           `json:"success"`
	Host    *SSHHostConfig `json:"host,omitempty"`
	Error   *string        `json:"error,omitempty"`
}

type HostConfigDeletePayload struct {
	ID string `json:"id"`
}

type HostConfigDeleteResultPayload struct {
	Success bool    `json:"success"`
	ID      *string `json:"id,omitempty"`
	Error   *string `json:"error,omitempty"`
}

// ============================================================================
// Host Connection Payloads (runtime)
// ============================================================================

type HostConnectPayload struct {
	HostID string `json:"hostId"`
	// No credentials needed - bridge has them stored
}

type HostDisconnectPayload struct {
	HostID string `json:"hostId"`
}

// HostRequirements represents the installation status of required tools
type HostRequirements struct {
	ClaudeInstalled   bool    `json:"claudeInstalled"`
	ClaudePath        *string `json:"claudePath,omitempty"`
	AgentAPIInstalled bool    `json:"agentApiInstalled"`
	AgentAPIPath      *string `json:"agentApiPath,omitempty"`
	CheckedAt         string  `json:"checkedAt"` // ISO timestamp
}

type HostStatusPayload struct {
	HostID         string            `json:"hostId"`
	Connected      bool              `json:"connected"`
	Processes      []ProcessInfo     `json:"processes"`
	StaleProcesses *[]StaleProcess   `json:"staleProcesses,omitempty"`
	Error          *string           `json:"error,omitempty"`
	Requirements   *HostRequirements `json:"requirements,omitempty"`
}

type HostCheckRequirementsPayload struct {
	HostID string `json:"hostId"`
}

type HostRequirementsResultPayload struct {
	HostID       string           `json:"hostId"`
	Requirements HostRequirements `json:"requirements"`
	Error        *string          `json:"error,omitempty"`
}

// ============================================================================
// Process Management Payloads
// ============================================================================

type ProcessListPayload struct {
	HostID string `json:"hostId"`
}

type ProcessListResultPayload struct {
	HostID    string        `json:"hostId"`
	Processes []ProcessInfo `json:"processes"`
}

type ProcessCreatePayload struct {
	HostID string  `json:"hostId"`
	CWD    *string `json:"cwd,omitempty"`
	Cols   *int    `json:"cols,omitempty"`
	Rows   *int    `json:"rows,omitempty"`
}

type ProcessCreatedPayload struct {
	Process ProcessInfo `json:"process"`
}

type ProcessSelectPayload struct {
	ProcessID string `json:"processId"`
}

type ProcessKillPayload struct {
	ProcessID string `json:"processId"`
}

type ProcessKilledPayload struct {
	ProcessID string `json:"processId"`
}

type ProcessReattachPayload struct {
	HostID      string `json:"hostId"`
	TmuxSession string `json:"tmuxSession"`
	ProcessID   string `json:"processId"` // Original process ID from tmux session name
}

type ProcessRenamePayload struct {
	ProcessID string `json:"processId"`
	Name      string `json:"name"`
}

type ProcessUpdatedPayload struct {
	ID            string      `json:"id"`
	Type          ProcessType `json:"type"`
	Port          *int        `json:"port,omitempty"`
	Name          *string     `json:"name,omitempty"`
	PtyReady      bool        `json:"ptyReady"`
	AgentAPIReady bool        `json:"agentApiReady"`
	ShellPID      *int        `json:"shellPid,omitempty"`
	AgentAPIPID   *int        `json:"agentApiPid,omitempty"`
}

// ============================================================================
// Claude Conversion Payloads
// ============================================================================

type ClaudeStartPayload struct {
	ProcessID  string  `json:"processId"`
	ClaudeArgs *string `json:"claudeArgs,omitempty"` // Optional extra arguments for claude command
}

type ClaudeKillPayload struct {
	ProcessID string `json:"processId"`
}

// ============================================================================
// PTY (Terminal) Payloads
// ============================================================================

type PtyInputPayload struct {
	ProcessID string `json:"processId"`
	Data      string `json:"data"`
}

type PtyOutputPayload struct {
	ProcessID string `json:"processId"`
	Data      string `json:"data"`
}

type PtyResizePayload struct {
	ProcessID string `json:"processId"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

// ============================================================================
// PTY History Payloads
// ============================================================================

type PtyHistoryRequestPayload struct {
	ProcessID string `json:"processId"`
}

type PtyHistoryResponsePayload struct {
	ProcessID  string `json:"processId"`
	TotalSize  int64  `json:"totalSize"`
	Compressed bool   `json:"compressed"`
}

type PtyHistoryChunkPayload struct {
	ProcessID   string `json:"processId"`
	Data        string `json:"data"` // Base64 encoded
	ChunkIndex  int    `json:"chunkIndex"`
	TotalChunks int    `json:"totalChunks"`
	IsLast      bool   `json:"isLast"`
}

type PtyHistoryCompletePayload struct {
	ProcessID string  `json:"processId"`
	Success   bool    `json:"success"`
	Error     *string `json:"error,omitempty"`
}

// ============================================================================
// Chat (AgentAPI) Payloads
// ============================================================================

type ChatSubscribePayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
}

type ChatUnsubscribePayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
}

type ChatSendPayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
	Content   string `json:"content"`
}

type ChatRawPayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
	Content   string `json:"content"`
}

type MessageUpdateData struct {
	ID      int    `json:"id"`
	Role    string `json:"role"` // "user" or "assistant"
	Message string `json:"message"`
	Time    string `json:"time"` // ISO timestamp
}

type StatusChangeData struct {
	Status    string `json:"status"` // "running" or "stable"
	AgentType string `json:"agentType"`
}

type ChatEventPayload struct {
	HostID    string          `json:"hostId"`
	ProcessID string          `json:"processId"`
	Event     string          `json:"event"` // "message_update" or "status_change"
	Data      json.RawMessage `json:"data"`
}

type ChatStatusPayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
}

type ChatStatusResultPayload struct {
	HostID    string  `json:"hostId"`
	ProcessID string  `json:"processId"`
	Status    string  `json:"status"` // "running", "stable", "disconnected"
	AgentType *string `json:"agentType,omitempty"`
}

type ChatHistoryPayload struct {
	HostID    string `json:"hostId"`
	ProcessID string `json:"processId"`
}

type ChatMessage struct {
	ID      int    `json:"id"`
	Role    string `json:"role"` // "user" or "assistant"
	Message string `json:"message"`
	Time    string `json:"time"`
}

type ChatMessagesPayload struct {
	HostID    string        `json:"hostId"`
	ProcessID string        `json:"processId"`
	Messages  []ChatMessage `json:"messages"`
}

// ============================================================================
// Error Payload
// ============================================================================

type ErrorPayload struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// ============================================================================
// Environment Variables Payloads
// ============================================================================

type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Host-level env management
type EnvListPayload struct {
	HostID string `json:"hostId"`
}

type EnvUpdatePayload struct {
	HostID     string   `json:"hostId"`
	CustomVars []EnvVar `json:"customVars"`
}

type EnvResultPayload struct {
	HostID         string   `json:"hostId"`
	SystemVars     []EnvVar `json:"systemVars"`
	CustomVars     []EnvVar `json:"customVars"`
	RcFile         string   `json:"rcFile"`
	DetectedRcFile string   `json:"detectedRcFile"`
	Error          *string  `json:"error,omitempty"`
}

type EnvSetRcFilePayload struct {
	HostID string `json:"hostId"`
	RcFile string `json:"rcFile"`
}

// Process-level env viewer (read-only)
type ProcessEnvListPayload struct {
	ProcessID string `json:"processId"`
}

type ProcessEnvResultPayload struct {
	ProcessID string   `json:"processId"`
	Vars      []EnvVar `json:"vars"`
	Error     *string  `json:"error,omitempty"`
}

// ============================================================================
// Ports Scanning Payloads
// ============================================================================

type PortsScanPayload struct {
	HostID string `json:"hostId"`
}

type PortInfo struct {
	Port        int          `json:"port"`
	Status      string       `json:"status"` // "active", "refused", "timeout", "unknown"
	ProcessID   *string      `json:"processId,omitempty"`
	ProcessName *string      `json:"processName,omitempty"`
	ProcessType *ProcessType `json:"processType,omitempty"`
	// Enriched from netstat/ss/lsof
	NetPID     *int    `json:"netPid,omitempty"`
	NetProcess *string `json:"netProcess,omitempty"`
	NetUser    *string `json:"netUser,omitempty"`
}

type PortsResultPayload struct {
	HostID       string     `json:"hostId"`
	Ports        []PortInfo `json:"ports"`
	NetTool      *string    `json:"netTool,omitempty"`      // Which tool was used
	NetToolError *string    `json:"netToolError,omitempty"` // Error if no tool available
	Error        *string    `json:"error,omitempty"`
}

// ============================================================================
// Snippets Payloads
// ============================================================================

// Snippet represents a command snippet saved for quick terminal access
type Snippet struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"` // ISO timestamp
	UpdatedAt string `json:"updatedAt"` // ISO timestamp
}

type SnippetListPayload struct {
	// empty - no params needed
}

type SnippetListResultPayload struct {
	Snippets []Snippet `json:"snippets"`
}

type SnippetCreatePayload struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type SnippetCreateResultPayload struct {
	Success bool     `json:"success"`
	Snippet *Snippet `json:"snippet,omitempty"`
	Error   *string  `json:"error,omitempty"`
}

type SnippetUpdatePayload struct {
	ID      string  `json:"id"`
	Name    *string `json:"name,omitempty"`
	Content *string `json:"content,omitempty"`
}

type SnippetUpdateResultPayload struct {
	Success bool     `json:"success"`
	Snippet *Snippet `json:"snippet,omitempty"`
	Error   *string  `json:"error,omitempty"`
}

type SnippetDeletePayload struct {
	ID string `json:"id"`
}

type SnippetDeleteResultPayload struct {
	Success bool    `json:"success"`
	ID      *string `json:"id,omitempty"`
	Error   *string `json:"error,omitempty"`
}
