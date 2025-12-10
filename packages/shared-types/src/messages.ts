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

  // Host Management
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

  // Claude Conversion
  CLAUDE_START: 'claude_start',
  CLAUDE_KILL: 'claude_kill',

  // PTY (Terminal)
  PTY_INPUT: 'pty_input',
  PTY_OUTPUT: 'pty_output',
  PTY_RESIZE: 'pty_resize',

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
  ptyReady: boolean;
  agentApiReady: boolean;
  startedAt: string; // ISO timestamp
  shellPid?: number;
  agentApiPid?: number;
}

export interface StaleProcess {
  port: number;
  reason: string; // "connection_refused", "timeout", etc.
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
// Host Management Payloads
// ============================================================================

export interface HostConnectPayload {
  hostId: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKey?: string;
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

export interface ProcessUpdatedPayload {
  id: string;
  type: ProcessType;
  port?: number;
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

  // Host
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

  // Error
  error: (payload: ErrorPayload) =>
    createMessage(MessageTypes.ERROR, payload),
};
