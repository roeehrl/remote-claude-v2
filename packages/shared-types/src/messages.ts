/**
 * WebSocket Protocol Message Types
 *
 * These type strings MUST match exactly between TypeScript and Go.
 * Protocol alignment tests verify this.
 */

// ============================================================================
// Message Type Constants
// ============================================================================

export const MessageTypes = {
  // Authentication
  AUTH: 'auth',
  AUTH_RESULT: 'auth_result',

  // Host Configuration (CRUD - stored in bridge)
  HOST_CONFIG_LIST: 'host_config_list',
  HOST_CONFIG_LIST_RESULT: 'host_config_list_result',
  HOST_CONFIG_CREATE: 'host_config_create',
  HOST_CONFIG_CREATE_RESULT: 'host_config_create_result',
  HOST_CONFIG_UPDATE: 'host_config_update',
  HOST_CONFIG_UPDATE_RESULT: 'host_config_update_result',
  HOST_CONFIG_DELETE: 'host_config_delete',
  HOST_CONFIG_DELETE_RESULT: 'host_config_delete_result',

  // Host Connection (runtime)
  HOST_CONNECT: 'host_connect',
  HOST_DISCONNECT: 'host_disconnect',
  HOST_STATUS: 'host_status',
  HOST_CHECK_REQUIREMENTS: 'host_check_requirements',
  HOST_REQUIREMENTS_RESULT: 'host_requirements_result',

  // Process Management
  PROCESS_LIST: 'process_list',
  PROCESS_LIST_RESULT: 'process_list_result',
  PROCESS_CREATE: 'process_create',
  PROCESS_CREATED: 'process_created',
  PROCESS_SELECT: 'process_select',
  PROCESS_KILL: 'process_kill',
  PROCESS_KILLED: 'process_killed',
  PROCESS_UPDATED: 'process_updated',
  PROCESS_REATTACH: 'process_reattach',
  PROCESS_RENAME: 'process_rename',

  // Claude Conversion
  CLAUDE_START: 'claude_start',
  CLAUDE_KILL: 'claude_kill',

  // PTY (Terminal)
  PTY_INPUT: 'pty_input',
  PTY_OUTPUT: 'pty_output',
  PTY_RESIZE: 'pty_resize',

  // PTY History
  PTY_HISTORY_REQUEST: 'pty_history_request',
  PTY_HISTORY_RESPONSE: 'pty_history_response',
  PTY_HISTORY_CHUNK: 'pty_history_chunk',
  PTY_HISTORY_COMPLETE: 'pty_history_complete',

  // Chat (AgentAPI)
  CHAT_SUBSCRIBE: 'chat_subscribe',
  CHAT_UNSUBSCRIBE: 'chat_unsubscribe',
  CHAT_SEND: 'chat_send',
  CHAT_RAW: 'chat_raw',
  CHAT_EVENT: 'chat_event',
  CHAT_STATUS: 'chat_status',
  CHAT_STATUS_RESULT: 'chat_status_result',
  CHAT_HISTORY: 'chat_history',
  CHAT_MESSAGES: 'chat_messages',

  // Environment Variables - Host Level
  ENV_LIST: 'env_list',
  ENV_UPDATE: 'env_update',
  ENV_RESULT: 'env_result',
  ENV_SET_RC_FILE: 'env_set_rc_file',

  // Environment Variables - Process Level
  PROCESS_ENV_LIST: 'process_env_list',
  PROCESS_ENV_RESULT: 'process_env_result',

  // Ports Scanning
  PORTS_SCAN: 'ports_scan',
  PORTS_RESULT: 'ports_result',

  // Snippets (global, unrelated to hosts/processes)
  SNIPPET_LIST: 'snippet_list',
  SNIPPET_LIST_RESULT: 'snippet_list_result',
  SNIPPET_CREATE: 'snippet_create',
  SNIPPET_CREATE_RESULT: 'snippet_create_result',
  SNIPPET_UPDATE: 'snippet_update',
  SNIPPET_UPDATE_RESULT: 'snippet_update_result',
  SNIPPET_DELETE: 'snippet_delete',
  SNIPPET_DELETE_RESULT: 'snippet_delete_result',

  // Error
  ERROR: 'error',
} as const;

export type MessageType = typeof MessageTypes[keyof typeof MessageTypes];

// ============================================================================
// Base Message
// ============================================================================

export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
  timestamp: number;
}

// ============================================================================
// Process Types
// ============================================================================

export type ProcessType = 'shell' | 'claude';

export interface ProcessInfo {
  id: string;
  type: ProcessType;
  hostId: string;
  port?: number;
  cwd: string;
  name?: string; // Custom user-defined name
  ptyReady: boolean;
  agentApiReady: boolean;
  startedAt: string; // ISO timestamp
  shellPid?: number;
  agentApiPid?: number;
}

export interface StaleProcess {
  port?: number; // AgentAPI port (if applicable)
  reason: string; // "connection_refused", "timeout", "detached"
  tmuxSession?: string; // tmux session name (for reattach)
  processId?: string; // Process ID extracted from tmux name
  startedAt?: string; // When the session was created
}

// ============================================================================
// Authentication Payloads
// ============================================================================

export interface AuthPayload {
  reconnectToken?: string; // Optional token for reconnection
}

export interface AuthResultPayload {
  success: boolean;
  sessionId?: string;
  reconnectToken?: string; // Token to use for reconnection
  reconnected: boolean; // Whether this was a reconnection
  error?: string;
}

// ============================================================================
// Host Configuration Payloads (CRUD - stored in bridge)
// ============================================================================

export type AuthType = 'password' | 'key';

/** SSH host configuration stored in bridge */
export interface SSHHostConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  autoConnect: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  // Note: credentials are NOT included in list results for security
}

// List all configured hosts
export interface HostConfigListPayload {
  // empty - no params needed
}

export interface HostConfigListResultPayload {
  hosts: SSHHostConfig[];
}

// Create a new host
export interface HostConfigCreatePayload {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  credential: string; // password or private key
  autoConnect?: boolean;
}

export interface HostConfigCreateResultPayload {
  success: boolean;
  host?: SSHHostConfig;
  error?: string;
}

// Update an existing host
export interface HostConfigUpdatePayload {
  id: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  credential?: string; // only set if changing credential
  autoConnect?: boolean;
}

export interface HostConfigUpdateResultPayload {
  success: boolean;
  host?: SSHHostConfig;
  error?: string;
}

// Delete a host
export interface HostConfigDeletePayload {
  id: string;
}

export interface HostConfigDeleteResultPayload {
  success: boolean;
  id?: string;
  error?: string;
}

// ============================================================================
// Host Connection Payloads (runtime)
// ============================================================================

export interface HostConnectPayload {
  hostId: string;
  // No credentials needed - bridge has them stored
}

export interface HostDisconnectPayload {
  hostId: string;
}

export interface HostRequirements {
  claudeInstalled: boolean;
  claudePath?: string;
  agentApiInstalled: boolean;
  agentApiPath?: string;
  checkedAt: string; // ISO timestamp
}

export interface HostStatusPayload {
  hostId: string;
  connected: boolean;
  processes: ProcessInfo[];
  staleProcesses?: StaleProcess[];
  error?: string;
  requirements?: HostRequirements;
}

export interface HostCheckRequirementsPayload {
  hostId: string;
}

export interface HostRequirementsResultPayload {
  hostId: string;
  requirements: HostRequirements;
  error?: string;
}

// ============================================================================
// Process Management Payloads
// ============================================================================

export interface ProcessListPayload {
  hostId: string;
}

export interface ProcessListResultPayload {
  hostId: string;
  processes: ProcessInfo[];
}

export interface ProcessCreatePayload {
  hostId: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface ProcessCreatedPayload {
  process: ProcessInfo;
}

export interface ProcessSelectPayload {
  processId: string;
}

export interface ProcessKillPayload {
  processId: string;
}

export interface ProcessKilledPayload {
  processId: string;
}

export interface ProcessReattachPayload {
  hostId: string;
  tmuxSession: string;
  processId: string; // Original process ID from tmux session name
}

export interface ProcessRenamePayload {
  processId: string;
  name: string;
}

export interface ProcessUpdatedPayload {
  id: string;
  type: ProcessType;
  port?: number;
  name?: string;
  ptyReady: boolean;
  agentApiReady: boolean;
  shellPid?: number;
  agentApiPid?: number;
}

// ============================================================================
// Claude Conversion Payloads
// ============================================================================

export interface ClaudeStartPayload {
  processId: string;
  claudeArgs?: string; // Optional extra arguments for claude command (e.g., "--continue", "-s")
}

export interface ClaudeKillPayload {
  processId: string;
}

// ============================================================================
// PTY (Terminal) Payloads
// ============================================================================

export interface PtyInputPayload {
  processId: string;
  data: string;
}

export interface PtyOutputPayload {
  processId: string;
  data: string;
}

export interface PtyResizePayload {
  processId: string;
  cols: number;
  rows: number;
}

// ============================================================================
// PTY History Payloads
// ============================================================================

export interface PtyHistoryRequestPayload {
  processId: string;
}

export interface PtyHistoryResponsePayload {
  processId: string;
  totalSize: number;
  compressed: boolean;
}

export interface PtyHistoryChunkPayload {
  processId: string;
  data: string; // Base64 encoded
  chunkIndex: number;
  totalChunks: number;
  isLast: boolean;
}

export interface PtyHistoryCompletePayload {
  processId: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Chat (AgentAPI) Payloads
// ============================================================================

export interface ChatSubscribePayload {
  hostId: string;
  processId: string;
}

export interface ChatUnsubscribePayload {
  hostId: string;
  processId: string;
}

export interface ChatSendPayload {
  hostId: string;
  processId: string;
  content: string;
}

export interface ChatRawPayload {
  hostId: string;
  processId: string;
  content: string; // Raw keystroke, e.g., "\x03" for Ctrl+C
}

export type ChatEventType = 'message_update' | 'status_change';

export interface MessageUpdateData {
  id: number;
  role: 'user' | 'assistant';
  message: string;
  time: string; // ISO timestamp
}

export interface StatusChangeData {
  status: 'running' | 'stable';
  agentType: string;
}

export interface ChatEventPayload {
  hostId: string;
  processId: string;
  event: ChatEventType;
  data: MessageUpdateData | StatusChangeData;
}

export interface ChatStatusPayload {
  hostId: string;
  processId: string;
}

export interface ChatStatusResultPayload {
  hostId: string;
  processId: string;
  status: 'running' | 'stable' | 'disconnected';
  agentType?: string;
}

export interface ChatHistoryPayload {
  hostId: string;
  processId: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  message: string;
  time: string;
}

export interface ChatMessagesPayload {
  hostId: string;
  processId: string;
  messages: ChatMessage[];
}

// ============================================================================
// Environment Variables Payloads
// ============================================================================

export interface EnvVar {
  key: string;
  value: string;
}

// Host-level env management
export interface EnvListPayload {
  hostId: string;
}

export interface EnvUpdatePayload {
  hostId: string;
  customVars: EnvVar[];
}

export interface EnvResultPayload {
  hostId: string;
  systemVars: EnvVar[];
  customVars: EnvVar[];
  rcFile: string;
  detectedRcFile: string;
  error?: string;
}

export interface EnvSetRcFilePayload {
  hostId: string;
  rcFile: string;
}

// Process-level env viewer (read-only)
export interface ProcessEnvListPayload {
  processId: string;
}

export interface ProcessEnvResultPayload {
  processId: string;
  vars: EnvVar[];
  error?: string;
}

// ============================================================================
// Ports Scanning Payloads
// ============================================================================

export interface PortsScanPayload {
  hostId: string;
}

export interface PortInfo {
  port: number;
  status: 'active' | 'refused' | 'timeout' | 'unknown';
  processId?: string;        // From DB mapping
  processName?: string;      // From DB mapping
  processType?: ProcessType; // From DB mapping
  // Enriched from netstat/ss/lsof
  netPid?: number;          // PID from network tool
  netProcess?: string;      // Process name from network tool
  netUser?: string;         // User from network tool
}

export interface PortsResultPayload {
  hostId: string;
  ports: PortInfo[];
  netTool?: string;         // Which tool was used: 'ss', 'netstat', 'lsof', or undefined if none
  netToolError?: string;    // Error message if no tool available
  error?: string;
}

// ============================================================================
// Snippets Payloads
// ============================================================================

/** A command snippet saved for quick terminal access */
export interface Snippet {
  id: string;
  name: string;
  content: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// List all snippets
export interface SnippetListPayload {
  // empty - no params needed
}

export interface SnippetListResultPayload {
  snippets: Snippet[];
}

// Create a new snippet
export interface SnippetCreatePayload {
  name: string;
  content: string;
}

export interface SnippetCreateResultPayload {
  success: boolean;
  snippet?: Snippet;
  error?: string;
}

// Update an existing snippet
export interface SnippetUpdatePayload {
  id: string;
  name?: string;
  content?: string;
}

export interface SnippetUpdateResultPayload {
  success: boolean;
  snippet?: Snippet;
  error?: string;
}

// Delete a snippet
export interface SnippetDeletePayload {
  id: string;
}

export interface SnippetDeleteResultPayload {
  success: boolean;
  id?: string;
  error?: string;
}

// ============================================================================
// Error Payload
// ============================================================================

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// Message Creators (type-safe helpers)
// ============================================================================

export function createMessage<T>(type: MessageType, payload: T): Message<T> {
  return {
    type,
    payload,
    timestamp: Date.now(),
  };
}

// Typed message creators for each message type
export const Messages = {
  // Auth
  auth: (payload: AuthPayload = {}) =>
    createMessage(MessageTypes.AUTH, payload),

  authResult: (payload: AuthResultPayload) =>
    createMessage(MessageTypes.AUTH_RESULT, payload),

  // Host Config (CRUD)
  hostConfigList: () =>
    createMessage(MessageTypes.HOST_CONFIG_LIST, {}),

  hostConfigListResult: (payload: HostConfigListResultPayload) =>
    createMessage(MessageTypes.HOST_CONFIG_LIST_RESULT, payload),

  hostConfigCreate: (payload: HostConfigCreatePayload) =>
    createMessage(MessageTypes.HOST_CONFIG_CREATE, payload),

  hostConfigCreateResult: (payload: HostConfigCreateResultPayload) =>
    createMessage(MessageTypes.HOST_CONFIG_CREATE_RESULT, payload),

  hostConfigUpdate: (payload: HostConfigUpdatePayload) =>
    createMessage(MessageTypes.HOST_CONFIG_UPDATE, payload),

  hostConfigUpdateResult: (payload: HostConfigUpdateResultPayload) =>
    createMessage(MessageTypes.HOST_CONFIG_UPDATE_RESULT, payload),

  hostConfigDelete: (payload: HostConfigDeletePayload) =>
    createMessage(MessageTypes.HOST_CONFIG_DELETE, payload),

  hostConfigDeleteResult: (payload: HostConfigDeleteResultPayload) =>
    createMessage(MessageTypes.HOST_CONFIG_DELETE_RESULT, payload),

  // Host Connection (runtime)
  hostConnect: (payload: HostConnectPayload) =>
    createMessage(MessageTypes.HOST_CONNECT, payload),

  hostDisconnect: (payload: HostDisconnectPayload) =>
    createMessage(MessageTypes.HOST_DISCONNECT, payload),

  hostStatus: (payload: HostStatusPayload) =>
    createMessage(MessageTypes.HOST_STATUS, payload),

  hostCheckRequirements: (payload: HostCheckRequirementsPayload) =>
    createMessage(MessageTypes.HOST_CHECK_REQUIREMENTS, payload),

  hostRequirementsResult: (payload: HostRequirementsResultPayload) =>
    createMessage(MessageTypes.HOST_REQUIREMENTS_RESULT, payload),

  // Process
  processList: (payload: ProcessListPayload) =>
    createMessage(MessageTypes.PROCESS_LIST, payload),

  processListResult: (payload: ProcessListResultPayload) =>
    createMessage(MessageTypes.PROCESS_LIST_RESULT, payload),

  processCreate: (payload: ProcessCreatePayload) =>
    createMessage(MessageTypes.PROCESS_CREATE, payload),

  processCreated: (payload: ProcessCreatedPayload) =>
    createMessage(MessageTypes.PROCESS_CREATED, payload),

  processSelect: (payload: ProcessSelectPayload) =>
    createMessage(MessageTypes.PROCESS_SELECT, payload),

  processKill: (payload: ProcessKillPayload) =>
    createMessage(MessageTypes.PROCESS_KILL, payload),

  processKilled: (payload: ProcessKilledPayload) =>
    createMessage(MessageTypes.PROCESS_KILLED, payload),

  processUpdated: (payload: ProcessUpdatedPayload) =>
    createMessage(MessageTypes.PROCESS_UPDATED, payload),

  processReattach: (payload: ProcessReattachPayload) =>
    createMessage(MessageTypes.PROCESS_REATTACH, payload),

  processRename: (payload: ProcessRenamePayload) =>
    createMessage(MessageTypes.PROCESS_RENAME, payload),

  // Claude conversion
  claudeStart: (payload: ClaudeStartPayload) =>
    createMessage(MessageTypes.CLAUDE_START, payload),

  claudeKill: (payload: ClaudeKillPayload) =>
    createMessage(MessageTypes.CLAUDE_KILL, payload),

  // PTY
  ptyInput: (payload: PtyInputPayload) =>
    createMessage(MessageTypes.PTY_INPUT, payload),

  ptyOutput: (payload: PtyOutputPayload) =>
    createMessage(MessageTypes.PTY_OUTPUT, payload),

  ptyResize: (payload: PtyResizePayload) =>
    createMessage(MessageTypes.PTY_RESIZE, payload),

  // PTY History
  ptyHistoryRequest: (payload: PtyHistoryRequestPayload) =>
    createMessage(MessageTypes.PTY_HISTORY_REQUEST, payload),

  ptyHistoryResponse: (payload: PtyHistoryResponsePayload) =>
    createMessage(MessageTypes.PTY_HISTORY_RESPONSE, payload),

  ptyHistoryChunk: (payload: PtyHistoryChunkPayload) =>
    createMessage(MessageTypes.PTY_HISTORY_CHUNK, payload),

  ptyHistoryComplete: (payload: PtyHistoryCompletePayload) =>
    createMessage(MessageTypes.PTY_HISTORY_COMPLETE, payload),

  // Chat
  chatSubscribe: (payload: ChatSubscribePayload) =>
    createMessage(MessageTypes.CHAT_SUBSCRIBE, payload),

  chatUnsubscribe: (payload: ChatUnsubscribePayload) =>
    createMessage(MessageTypes.CHAT_UNSUBSCRIBE, payload),

  chatSend: (payload: ChatSendPayload) =>
    createMessage(MessageTypes.CHAT_SEND, payload),

  chatRaw: (payload: ChatRawPayload) =>
    createMessage(MessageTypes.CHAT_RAW, payload),

  chatEvent: (payload: ChatEventPayload) =>
    createMessage(MessageTypes.CHAT_EVENT, payload),

  chatStatus: (payload: ChatStatusPayload) =>
    createMessage(MessageTypes.CHAT_STATUS, payload),

  chatStatusResult: (payload: ChatStatusResultPayload) =>
    createMessage(MessageTypes.CHAT_STATUS_RESULT, payload),

  chatHistory: (payload: ChatHistoryPayload) =>
    createMessage(MessageTypes.CHAT_HISTORY, payload),

  chatMessages: (payload: ChatMessagesPayload) =>
    createMessage(MessageTypes.CHAT_MESSAGES, payload),

  // Environment Variables - Host Level
  envList: (payload: EnvListPayload) =>
    createMessage(MessageTypes.ENV_LIST, payload),

  envUpdate: (payload: EnvUpdatePayload) =>
    createMessage(MessageTypes.ENV_UPDATE, payload),

  envResult: (payload: EnvResultPayload) =>
    createMessage(MessageTypes.ENV_RESULT, payload),

  envSetRcFile: (payload: EnvSetRcFilePayload) =>
    createMessage(MessageTypes.ENV_SET_RC_FILE, payload),

  // Environment Variables - Process Level
  processEnvList: (payload: ProcessEnvListPayload) =>
    createMessage(MessageTypes.PROCESS_ENV_LIST, payload),

  processEnvResult: (payload: ProcessEnvResultPayload) =>
    createMessage(MessageTypes.PROCESS_ENV_RESULT, payload),

  // Ports Scanning
  portsScan: (payload: PortsScanPayload) =>
    createMessage(MessageTypes.PORTS_SCAN, payload),

  portsResult: (payload: PortsResultPayload) =>
    createMessage(MessageTypes.PORTS_RESULT, payload),

  // Snippets
  snippetList: () =>
    createMessage(MessageTypes.SNIPPET_LIST, {}),

  snippetListResult: (payload: SnippetListResultPayload) =>
    createMessage(MessageTypes.SNIPPET_LIST_RESULT, payload),

  snippetCreate: (payload: SnippetCreatePayload) =>
    createMessage(MessageTypes.SNIPPET_CREATE, payload),

  snippetCreateResult: (payload: SnippetCreateResultPayload) =>
    createMessage(MessageTypes.SNIPPET_CREATE_RESULT, payload),

  snippetUpdate: (payload: SnippetUpdatePayload) =>
    createMessage(MessageTypes.SNIPPET_UPDATE, payload),

  snippetUpdateResult: (payload: SnippetUpdateResultPayload) =>
    createMessage(MessageTypes.SNIPPET_UPDATE_RESULT, payload),

  snippetDelete: (payload: SnippetDeletePayload) =>
    createMessage(MessageTypes.SNIPPET_DELETE, payload),

  snippetDeleteResult: (payload: SnippetDeleteResultPayload) =>
    createMessage(MessageTypes.SNIPPET_DELETE_RESULT, payload),

  // Error
  error: (payload: ErrorPayload) =>
    createMessage(MessageTypes.ERROR, payload),
};
