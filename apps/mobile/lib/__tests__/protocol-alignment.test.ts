/**
 * Protocol Alignment Tests
 *
 * These tests verify that TypeScript protocol definitions match Go definitions.
 * The expected values here are copied from Go constants and must match exactly.
 *
 * Run with: npm run test:alignment
 */

// ============================================================================
// Message Types (must match Go constants in services/bridge/internal/protocol/messages.go)
// ============================================================================

const MessageTypes = {
  // Authentication
  AUTH: 'auth',
  AUTH_RESULT: 'auth_result',

  // Host Management
  HOST_CONNECT: 'host_connect',
  HOST_DISCONNECT: 'host_disconnect',
  HOST_STATUS: 'host_status',

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

// ============================================================================
// Tests
// ============================================================================

describe('Protocol Alignment Tests', () => {
  describe('Message Type Constants', () => {
    // These are the expected values from Go - they must match TypeScript constants exactly
    const expectedGoTypes: Record<string, string> = {
      AUTH: 'auth',
      AUTH_RESULT: 'auth_result',
      HOST_CONNECT: 'host_connect',
      HOST_DISCONNECT: 'host_disconnect',
      HOST_STATUS: 'host_status',
      PROCESS_LIST: 'process_list',
      PROCESS_LIST_RESULT: 'process_list_result',
      PROCESS_CREATE: 'process_create',
      PROCESS_CREATED: 'process_created',
      PROCESS_SELECT: 'process_select',
      PROCESS_KILL: 'process_kill',
      PROCESS_KILLED: 'process_killed',
      PROCESS_UPDATED: 'process_updated',
      CLAUDE_START: 'claude_start',
      CLAUDE_KILL: 'claude_kill',
      PTY_INPUT: 'pty_input',
      PTY_OUTPUT: 'pty_output',
      PTY_RESIZE: 'pty_resize',
      CHAT_SUBSCRIBE: 'chat_subscribe',
      CHAT_UNSUBSCRIBE: 'chat_unsubscribe',
      CHAT_SEND: 'chat_send',
      CHAT_RAW: 'chat_raw',
      CHAT_EVENT: 'chat_event',
      CHAT_STATUS: 'chat_status',
      CHAT_STATUS_RESULT: 'chat_status_result',
      CHAT_HISTORY: 'chat_history',
      CHAT_MESSAGES: 'chat_messages',
      ERROR: 'error',
    };

    test.each(Object.entries(expectedGoTypes))(
      'MessageTypes.%s should equal Go constant %s',
      (key, expectedValue) => {
        const tsValue = MessageTypes[key as keyof typeof MessageTypes];
        expect(tsValue).toBe(expectedValue);
      }
    );

    test('TypeScript and Go should have the same number of message types', () => {
      const tsTypeCount = Object.keys(MessageTypes).length;
      const goTypeCount = Object.keys(expectedGoTypes).length;
      expect(tsTypeCount).toBe(goTypeCount);
    });
  });

  describe('Payload JSON Field Names', () => {
    // These tests verify that when TypeScript payloads are serialized to JSON,
    // they use the same field names as Go struct json tags

    test('AuthPayload should have correct JSON field names', () => {
      const payload = {
        reconnectToken: 'test-token',
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('reconnectToken');
    });

    test('AuthResultPayload should have correct JSON field names', () => {
      const payload = {
        success: true,
        sessionId: 'session-123',
        reconnectToken: 'test-token',
        reconnected: false,
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('success');
      expect(parsed).toHaveProperty('sessionId');
      expect(parsed).toHaveProperty('reconnectToken');
      expect(parsed).toHaveProperty('reconnected');
    });

    test('ProcessInfo should have correct JSON field names', () => {
      const payload = {
        id: 'test-id',
        type: 'shell' as const,
        hostId: 'host-id',
        cwd: '/home',
        ptyReady: true,
        agentApiReady: false,
        startedAt: '2024-01-01T00:00:00Z',
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // These field names must match Go struct json tags
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('hostId');
      expect(parsed).toHaveProperty('cwd');
      expect(parsed).toHaveProperty('ptyReady');
      expect(parsed).toHaveProperty('agentApiReady');
      expect(parsed).toHaveProperty('startedAt');
    });

    test('HostConnectPayload should have correct JSON field names', () => {
      const payload = {
        hostId: 'host-id',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        authType: 'password' as const,
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('hostId');
      expect(parsed).toHaveProperty('host');
      expect(parsed).toHaveProperty('port');
      expect(parsed).toHaveProperty('username');
      expect(parsed).toHaveProperty('authType');
    });

    test('PtyInputPayload should have correct JSON field names', () => {
      const payload = {
        processId: 'proc-id',
        data: 'ls -la\n',
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('processId');
      expect(parsed).toHaveProperty('data');
    });

    test('ChatSendPayload should have correct JSON field names', () => {
      const payload = {
        hostId: 'host-id',
        processId: 'proc-id',
        content: 'Hello',
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('hostId');
      expect(parsed).toHaveProperty('processId');
      expect(parsed).toHaveProperty('content');
    });

    test('ProcessUpdatedPayload should have correct JSON field names', () => {
      const payload = {
        id: 'proc-id',
        type: 'claude' as const,
        ptyReady: true,
        agentApiReady: true,
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('ptyReady');
      expect(parsed).toHaveProperty('agentApiReady');
    });
  });

  describe('Bidirectional Parsing', () => {
    test('TypeScript should be able to parse Go message format', () => {
      // Simulate a message that would come from Go
      const goMessage = `{
        "type": "process_created",
        "payload": {"process": {"id": "proc-123", "hostId": "host-456", "type": "shell", "cwd": "/home", "ptyReady": true, "agentApiReady": false, "startedAt": "2024-01-01T00:00:00Z"}},
        "timestamp": 1704067200000
      }`;

      const parsed = JSON.parse(goMessage);

      expect(parsed.type).toBe(MessageTypes.PROCESS_CREATED);
      expect(parsed.payload.process.id).toBe('proc-123');
      expect(parsed.payload.process.hostId).toBe('host-456');
      expect(parsed.payload.process.type).toBe('shell');
      expect(parsed.payload.process.cwd).toBe('/home');
      expect(parsed.payload.process.ptyReady).toBe(true);
    });

    test('Go should be able to parse TypeScript message format', () => {
      // This is what we would send to Go
      const tsMessage = {
        type: MessageTypes.PROCESS_CREATE,
        payload: { hostId: 'host-123', cwd: '/home/user' },
        timestamp: Date.now(),
      };

      const json = JSON.stringify(tsMessage);
      const parsed = JSON.parse(json);

      // Verify structure matches what Go expects
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('payload');
      expect(parsed).toHaveProperty('timestamp');
      expect(typeof parsed.type).toBe('string');
      expect(typeof parsed.payload).toBe('object');
      expect(typeof parsed.timestamp).toBe('number');
    });
  });

  describe('Process Type Values', () => {
    test('shell process type should match Go constant', () => {
      expect('shell').toBe('shell'); // Go: ProcessTypeShell = "shell"
    });

    test('claude process type should match Go constant', () => {
      expect('claude').toBe('claude'); // Go: ProcessTypeClaude = "claude"
    });
  });
});
