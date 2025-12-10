# Bridge-AgentAPI Integration

This document describes how the mobile app frontend interacts with AgentAPI (HTTP) through the Bridge service (WebSocket).

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Mobile App    │   WS    │     Bridge      │  HTTP   │    AgentAPI     │
│   (Frontend)    │◄───────►│   (Go Server)   │◄───────►│  (on VM via     │
│                 │         │                 │  (SSH   │   SSH tunnel)   │
│                 │         │                 │  Tunnel)│                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

The Bridge acts as a proxy that:

1. **Receives WebSocket messages from the mobile app**
2. **Translates them to HTTP calls to AgentAPI** (via SSH tunnel)
3. **Maintains SSE connections to AgentAPI** and forwards events back to the app

**Security**: All AgentAPI HTTP calls go through SSH tunnel. AgentAPI has no authentication - it's secured by the SSH connection.

---

## WebSocket Protocol (App ↔ Bridge)

### Message Types

| Message Type | Direction | Purpose | Bridge Action |
|--------------|-----------|---------|---------------|
| `chat_subscribe` | App → Bridge | Start receiving events | Opens SSE to `/events` |
| `chat_unsubscribe` | App → Bridge | Stop receiving events | Closes SSE connection |
| `chat_send` | App → Bridge | Send user message | `POST /message` type=user |
| `chat_raw` | App → Bridge | Send keystrokes | `POST /message` type=raw |
| `chat_upload` | App → Bridge | Upload file | `POST /upload` |
| `chat_status` | App → Bridge | Get current status | `GET /status` |
| `chat_messages` | App → Bridge | Get history | `GET /messages` |
| `chat_screen_subscribe` | App → Bridge | Start raw screen stream | Opens SSE to `/internal/screen` |
| `chat_screen_unsubscribe` | App → Bridge | Stop raw screen stream | Closes screen SSE |
| `chat_event` | Bridge → App | Forward SSE event | - |
| `chat_screen_event` | Bridge → App | Forward raw screen data | - |
| `chat_result` | Bridge → App | Response to request | - |

### Payload Definitions

```typescript
// App → Bridge: Subscribe to chat events
interface ChatSubscribePayload {
  hostId: string;
}

// App → Bridge: Send user message
interface ChatSendPayload {
  hostId: string;
  content: string;
}

// App → Bridge: Send raw keystrokes
interface ChatRawPayload {
  hostId: string;
  content: string;  // e.g., "\x03" for Ctrl+C
}

// App → Bridge: Upload file
interface ChatUploadPayload {
  hostId: string;
  filename: string;
  content: string;  // Base64 encoded
}

// App → Bridge: Get status
interface ChatStatusPayload {
  hostId: string;
}

// App → Bridge: Get message history
interface ChatMessagesPayload {
  hostId: string;
}

// App → Bridge: Subscribe to raw screen updates
interface ChatScreenSubscribePayload {
  hostId: string;
}

// Bridge → App: SSE event forwarded
interface ChatEventPayload {
  hostId: string;
  event: 'message_update' | 'status_change';
  data: MessageUpdateData | StatusChangeData;
}

// Bridge → App: Raw screen data forwarded
interface ChatScreenEventPayload {
  hostId: string;
  screen: string;  // Raw terminal output (ANSI sequences included)
}

interface MessageUpdateData {
  id: number;
  role: 'user' | 'agent';
  message: string;
  time: string;  // ISO timestamp
}

interface StatusChangeData {
  status: 'running' | 'stable';
  agentType: string;
}

// Bridge → App: Response to request
interface ChatResultPayload {
  hostId: string;
  success: boolean;
  error?: string;
  data?: any;
}
```

---

## Message Flow Diagrams

### 1. Subscribing to Chat Events

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_subscribe            │                            │
    │ {hostId}                  │                            │
    │ ─────────────────────────>│                            │
    │                           │  GET /events (SSE)         │
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  SSE connection open       │
    │                           │ <─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true}           │                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │                           │  event: message_update     │
    │                           │ <──────────────────────────│
    │ chat_event                │                            │
    │ {event: "message_update"} │                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │                           │  event: status_change      │
    │                           │ <──────────────────────────│
    │ chat_event                │                            │
    │ {event: "status_change"}  │                            │
    │ <─────────────────────────│                            │
```

### 2. Sending a User Message

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_send                 │                            │
    │ {hostId, content}         │                            │
    │ ─────────────────────────>│                            │
    │                           │  POST /message             │
    │                           │  {content, type:"user"}    │
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  {ok: true}                │
    │                           │ <──────────────────────────│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true}           │                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │                           │  SSE: status_change        │
    │                           │  {status: "running"}       │
    │                           │ <──────────────────────────│
    │ chat_event                │                            │
    │ {status: "running"}       │                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │                           │  SSE: message_update       │
    │                           │  (streaming response)      │
    │                           │ <──────────────────────────│
    │ chat_event                │                            │
    │ {message_update...}       │                            │
    │ <─────────────────────────│                            │
```

### 3. Sending Raw Keystrokes (Interrupt)

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_raw                  │                            │
    │ {hostId, content: "\x03"} │  (Ctrl+C)                  │
    │ ─────────────────────────>│                            │
    │                           │  POST /message             │
    │                           │  {content, type:"raw"}     │
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  {ok: true}                │
    │                           │ <──────────────────────────│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true}           │                            │
    │ <─────────────────────────│                            │
```

### 4. Getting Message History

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_messages             │                            │
    │ {hostId}                  │                            │
    │ ─────────────────────────>│                            │
    │                           │  GET /messages             │
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  [{id, role, message}...]  │
    │                           │ <──────────────────────────│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true,           │                            │
    │  data: [...messages]}     │                            │
    │ <─────────────────────────│                            │
```

### 5. Uploading a File

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_upload               │                            │
    │ {hostId, filename,        │                            │
    │  content: "base64..."}    │                            │
    │ ─────────────────────────>│                            │
    │                           │  POST /upload              │
    │                           │  (multipart/form-data)     │
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  {files: [{path, name}]}   │
    │                           │ <──────────────────────────│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true,           │                            │
    │  data: {path: "/tmp/..."}}│                            │
    │ <─────────────────────────│                            │
```

### 6. Viewing Raw Screen (Debug Feature)

```
Mobile App                    Bridge                      AgentAPI
    │                           │                            │
    │ chat_screen_subscribe     │                            │
    │ {hostId}                  │                            │
    │ ─────────────────────────>│                            │
    │                           │  GET /internal/screen (SSE)│
    │                           │ ──────────────────────────>│
    │                           │                            │
    │                           │  SSE connection open       │
    │                           │ <─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
    │                           │                            │
    │ chat_result               │                            │
    │ {success: true}           │                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │                           │  event: screen             │
    │                           │  {data: "raw terminal..."}│
    │                           │ <──────────────────────────│
    │ chat_screen_event         │                            │
    │ {screen: "raw terminal..."}                            │
    │ <─────────────────────────│                            │
    │                           │                            │
    │ chat_screen_unsubscribe   │                            │
    │ {hostId}                  │                            │
    │ ─────────────────────────>│                            │
    │                           │  Close SSE connection      │
    │                           │ ──────────────────────────>│
```

**Note**: The `/internal/screen` endpoint provides unprocessed terminal output including ANSI escape sequences. This is useful for debugging but not for normal chat display.

---

## Bridge Implementation Notes

### SSE Connection Management

- Bridge maintains **one SSE connection per subscribed host**
- Multiple app clients can subscribe to the same host (events are multiplexed)
- SSE connection is closed when last client unsubscribes
- Automatic reconnection with exponential backoff on connection loss

### HTTP Client via SSH Tunnel

All HTTP requests to AgentAPI must go through the SSH tunnel:

```go
// Create HTTP client that uses SSH tunnel
func (c *Connection) getTunneledHTTPClient() *http.Client {
    return &http.Client{
        Transport: &http.Transport{
            DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
                return c.sshClient.Dial(network, addr)
            },
        },
        Timeout: 30 * time.Second,
    }
}
```

### AgentAPI Base URL

AgentAPI runs on the remote host, accessed via SSH tunnel:

```
http://127.0.0.1:{AgentAPIPort}/
```

Default `AgentAPIPort` is **3284**.

---

## Frontend Usage Example

```typescript
// hooks/useChat.ts

export function useChat(hostId: string) {
  const { sendMessage, addMessageHandler } = useBridge();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'stable' | 'running'>('stable');

  // Subscribe to chat events on mount
  useEffect(() => {
    sendMessage({ type: 'chat_subscribe', payload: { hostId } });

    const unsubscribe = addMessageHandler('chat_event', (msg) => {
      if (msg.payload.hostId !== hostId) return;

      switch (msg.payload.event) {
        case 'message_update':
          handleMessageUpdate(msg.payload.data);
          break;
        case 'status_change':
          setStatus(msg.payload.data.status);
          break;
      }
    });

    return () => {
      sendMessage({ type: 'chat_unsubscribe', payload: { hostId } });
      unsubscribe();
    };
  }, [hostId]);

  // Send user message (only when stable)
  const send = useCallback((content: string) => {
    if (status !== 'stable') return;
    sendMessage({ type: 'chat_send', payload: { hostId, content } });
  }, [hostId, status]);

  // Send raw keystroke (anytime)
  const sendRaw = useCallback((content: string) => {
    sendMessage({ type: 'chat_raw', payload: { hostId, content } });
  }, [hostId]);

  // Upload file
  const uploadFile = useCallback(async (file: File) => {
    const content = await fileToBase64(file);
    sendMessage({
      type: 'chat_upload',
      payload: { hostId, filename: file.name, content }
    });
  }, [hostId]);

  return { messages, status, send, sendRaw, uploadFile };
}
```

---

## Error Handling

### Bridge → App Error Responses

```typescript
// Error response format
interface ChatResultPayload {
  hostId: string;
  success: false;
  error: string;  // Human-readable error message
  code?: string;  // Error code for programmatic handling
}

// Common error codes
type ErrorCode =
  | 'NOT_CONNECTED'      // SSH connection not established
  | 'AGENT_NOT_RUNNING'  // AgentAPI not available
  | 'AGENT_BUSY'         // Status is "running", can't send user message
  | 'UPLOAD_TOO_LARGE'   // File exceeds 10MB limit
  | 'TIMEOUT'            // Request timed out
  | 'SSE_DISCONNECTED';  // SSE connection lost
```

### Reconnection Strategy

```typescript
// Frontend reconnection logic
const reconnect = async () => {
  let delay = 1000;
  const maxDelay = 30000;

  while (!connected) {
    try {
      await sendMessage({ type: 'chat_subscribe', payload: { hostId } });
      delay = 1000;  // Reset on success
    } catch (err) {
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
};
```

---

## Key Rules

1. **`user` messages only when `stable`** - Bridge should reject if agent is running
2. **`raw` messages anytime** - For interrupts, always allowed
3. **One SSE per host** - Bridge manages connection lifecycle
4. **All HTTP via SSH tunnel** - Never direct connection to AgentAPI
5. **Base64 for file uploads** - Binary data encoded in JSON payload
