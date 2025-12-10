# Chat Tab - Design & Architecture

This document defines the Chat Tab functionality for the Remote Claude mobile app, leveraging ALL AgentAPI features for maximum transparency and robustness.

## AgentAPI Capabilities Summary

Based on [AgentAPI v0.11.4](https://github.com/coder/agentapi):

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Agent status: `running` or `stable` |
| `/messages` | GET | Full conversation history |
| `/message` | POST | Send message (`user` or `raw` type) |
| `/upload` | POST | Upload file (multipart/form-data, 10MB limit) |
| `/events` | GET | SSE stream for real-time updates |
| `/internal/screen` | GET | **Internal** SSE endpoint for raw screen updates only |

### SSE Event Types

| Event | Description | Payload | Available On |
|-------|-------------|---------|--------------|
| `message_update` | New/updated message | `{id, role, message, time}` | `/events` |
| `status_change` | Agent status changed | `{status, agent_type}` | `/events` |
| `screen_update` | Raw terminal screen content | `{screen}` | `/internal/screen` only |

**NOTE**: `screen_update` is EXCLUDED from `/events` endpoint. Only available on `/internal/screen`.

### Message Types

- **`user`**: Logged message, appears in conversation history. Agent must be `stable` to accept.
- **`raw`**: Direct keystrokes to terminal (e.g., Ctrl+C). Not logged. Can send anytime.

### Agent Status

- **`stable`**: Agent is idle, waiting for input. Can send `user` messages.
- **`running`**: Agent is processing. Can only send `raw` messages (for interrupts).

---

## AgentAPI Limitations

**CRITICAL**: AgentAPI does NOT expose the agent's internal state. Understanding these limitations is essential for setting correct expectations.

### ❌ NOT Available via AgentAPI

| Feature | Workaround |
|---------|------------|
| **Tool/Bash execution details** | Parse `screen_update` for patterns |
| **Thinking/reasoning blocks** | Not possible |
| **Structured tool results** | Parse from `screen_update` if needed |
| **Slash command list** | Hardcode known commands |
| **Tab completions** | Send Tab via `raw`, read `screen_update` |
| **Prompt history** | Send arrow keys via `raw` messages |
| **Cost/token usage** | Parse from screen if displayed |
| **File tree/context** | Not available |
| **MCP server status** | Not available |

### Supported Agent Types

AgentAPI supports multiple terminal-based AI agents with aliases:

| Agent Type | Aliases | Display Name |
|------------|---------|--------------|
| `claude` | `claude-code` | Claude Code |
| `goose` | - | Goose |
| `aider` | - | Aider |
| `codex` | `codex-cli` | Codex |
| `gemini` | `gemini-cli` | Gemini |
| `copilot` | `github-copilot` | Copilot |
| `amp` | - | Amp |
| `cursor` | `cursor-agent` | Cursor Agent |
| `auggie` | - | Auggie |
| `amazonq` | `amazon-q` | Amazon Q |
| `opencode` | - | Opencode |
| `custom` | - | Custom |

**Initial Prompt Support:**
AgentAPI can send an initial prompt when starting the agent. This is useful for:
- Resuming conversations
- Pre-seeding context
- Automated tasks

```bash
# CLI example
agentapi --initial-prompt "Continue working on the authentication feature"
```

---

## Chat Tab UI Architecture

### Main Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Status Bar                                │
│  [Claude Code]  Status: ● Running    Agent: claude-code          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     Message List                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🤖 Agent                                      10:32:15 AM  │ │
│  │ I'll help you implement that feature. Let me start by     │ │
│  │ examining the codebase...                                  │ │
│  │                                                            │ │
│  │ [View Raw Screen]                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 👤 You                                        10:32:10 AM  │ │
│  │ Add a dark mode toggle to the settings page                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🤖 Agent (streaming...)                       10:32:16 AM  │ │
│  │ Looking at src/components/Settings.tsx...                  │ │
│  │ █                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                       Input Area                                 │
│  ┌─────────────────────────────────────┐  ┌────┐  ┌──────────┐ │
│  │ Type a message...                   │  │ 📎 │  │  Send    │ │
│  └─────────────────────────────────────┘  └────┘  └──────────┘ │
│                                                                  │
│  [↑] [↓] [Esc] [Ctrl+C]  [y] [n]           Status: Ready        │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. Status Bar
Shows real-time agent state from `status_change` events:

```typescript
interface StatusBarProps {
  status: 'running' | 'stable';
  agentType: string;  // e.g., "claude-code"
  connected: boolean;
}
```

Visual indicators:
- **Green dot** + "Ready" = `stable`
- **Pulsing yellow dot** + "Running" = `running`
- **Red dot** + "Disconnected" = SSE connection lost

#### 2. Message List
Displays conversation from `message_update` events:

```typescript
interface ChatMessage {
  id: number;           // Unique, sequential ID
  role: 'user' | 'agent';
  content: string;      // Formatted message (80 chars/line from TUI)
  time: Date;
  isStreaming: boolean; // True if this is the last agent message and status=running
}
```

Features:
- **Auto-scroll** to latest message (smart: only if at bottom or user sent message)
- **Streaming indicator** on last agent message when `status=running`
- **Loading dots** when agent message is empty but status is `running`
- **"View Raw Screen"** button to see unprocessed terminal output
- **Copy message** button
- **Timestamp** display
- **Clickable URLs** in messages (detected via regex, open in browser)
- **Pull to refresh** to fetch full history via `GET /messages`

#### 3. Input Area
Handles message composition and sending:

```typescript
interface InputAreaProps {
  status: 'running' | 'stable';
  onSendMessage: (content: string) => void;
  onSendRaw: (content: string) => void;
  onUploadFile: (file: File) => void;
}
```

Features:
- **Text input** (disabled when `status=running`)
- **Send button** (disabled when `status=running`)
- **File attachment** button (uploads via `/upload`)
- **Interrupt buttons** (always enabled, send `raw` messages)

#### 4. Quick Actions Bar
Always-visible action buttons for common operations:

| Button | Action | Raw Content | When Visible |
|--------|--------|-------------|--------------|
| **↑** (Up) | Previous command/history | `\x1b[A` | Always |
| **↓** (Down) | Next command/history | `\x1b[B` | Always |
| **Esc** | Send Escape key | `\x1b` | Always |
| **Ctrl+C** | Send SIGINT (interrupt) | `\x03` | Always |
| Yes (y) | Confirm prompt | `y\r` | When stable |
| No (n) | Reject prompt | `n\r` | When stable |

**IMPORTANT**: The ↑, ↓, Esc, and Ctrl+C buttons send `raw` messages, so they work **even when the agent is running**. This is critical for:
- **Interrupting a stuck agent** (Ctrl+C)
- **Canceling an operation** (Esc)
- **Navigating prompt history** (↑/↓)

```
┌─────────────────────────────────────────────────────────────────┐
│  Quick Actions Bar                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [↑]  [↓]  [Esc]  [Ctrl+C]  [y]  [n]                           │
│                                                                  │
│   ▲     ▲     ▲       ▲       ▲    ▲                            │
│   │     │     │       │       │    │                            │
│   │     │     │       │       │    └─ Reject prompt (stable)    │
│   │     │     │       │       └─ Confirm prompt (stable only)   │
│   │     │     │       └─ INTERRUPT agent (always, even running) │
│   │     │     └─ Cancel/escape (always)                         │
│   │     └─ Next in history (always)                             │
│   └─ Previous in history (always)                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 5. Input Mode Toggle (Text vs Control)

Based on the official AgentAPI chat implementation, we support two input modes:

**Text Mode** (default):
- Multi-line text input
- Send button submits as `user` message
- Enter key submits (Shift+Enter for newline)
- File upload via drag-drop or button

**Control Mode**:
- Direct keystroke passthrough to terminal
- Every key press sent as `raw` message
- Supports arrow keys, Tab, Escape, Ctrl+key combos
- Visual feedback showing sent keystrokes
- No text accumulation - immediate send

```
┌─────────────────────────────────────────────────────────────────┐
│                        Input Modes                               │
├─────────────────────────────────────────────────────────────────┤
│  [Text] [Control]                                                │
│                                                                  │
│  TEXT MODE:                                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Type a message...                              [📎] [Send] ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  CONTROL MODE:                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │     Click to focus, then press any key to send              ││
│  │                                                             ││
│  │     Recent: [↑] [↓] [Tab] [Ctrl+C]                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

Control mode is essential for:
- Navigating prompt history (↑/↓ arrows)
- Tab completion
- Canceling operations (Ctrl+C)
- Reverse history search (Ctrl+R)
- Clearing screen (Ctrl+L)

---

## Data Flow

### Initial Load (Subscribe to SSE)

```
┌─────────┐         ┌─────────┐         ┌───────────┐
│ Mobile  │         │ Bridge  │         │ AgentAPI  │
│   App   │         │         │         │           │
└────┬────┘         └────┬────┘         └─────┬─────┘
     │                   │                    │
     │ chat_subscribe    │                    │
     │ ─────────────────>│                    │
     │                   │  GET /events (SSE) │
     │                   │ ──────────────────>│
     │                   │                    │
     │                   │ Initial state:     │
     │                   │ - All messages     │
     │                   │ - Current status   │
     │                   │ - Current screen   │
     │                   │ <──────────────────│
     │                   │                    │
     │ chat_event        │                    │
     │ (message_update)  │                    │
     │ <─────────────────│                    │
     │ chat_event        │                    │
     │ (status_change)   │                    │
     │ <─────────────────│                    │
     │ chat_event        │                    │
     │ (screen_update)   │                    │
     │ <─────────────────│                    │
```

### Sending a User Message

```
┌─────────┐         ┌─────────┐         ┌───────────┐
│ Mobile  │         │ Bridge  │         │ AgentAPI  │
│   App   │         │         │         │           │
└────┬────┘         └────┬────┘         └─────┬─────┘
     │                   │                    │
     │ chat_send         │                    │
     │ {content, "user"} │                    │
     │ ─────────────────>│                    │
     │                   │ POST /message      │
     │                   │ {content, "user"}  │
     │                   │ ──────────────────>│
     │                   │                    │
     │                   │ {ok: true}         │
     │                   │ <──────────────────│
     │                   │                    │
     │                   │ SSE: status_change │
     │                   │ {status: "running"}│
     │                   │ <──────────────────│
     │                   │                    │
     │ chat_event        │                    │
     │ (status_change)   │                    │
     │ <─────────────────│                    │
     │                   │                    │
     │                   │ SSE: message_update│
     │                   │ (streaming...)     │
     │                   │ <──────────────────│
     │                   │                    │
     │ chat_event        │                    │
     │ (message_update)  │                    │
     │ <─────────────────│                    │
```

### Sending an Interrupt (Raw Message)

```
┌─────────┐         ┌─────────┐         ┌───────────┐
│ Mobile  │         │ Bridge  │         │ AgentAPI  │
│   App   │         │         │         │           │
└────┬────┘         └────┬────┘         └─────┬─────┘
     │                   │                    │
     │ chat_raw          │                    │
     │ {content: "\x03"} │  (Ctrl+C)          │
     │ ─────────────────>│                    │
     │                   │ POST /message      │
     │                   │ {content, "raw"}   │
     │                   │ ──────────────────>│
     │                   │                    │
     │                   │ {ok: true}         │
     │                   │ <──────────────────│
```

---

## State Management (Zustand Store)

```typescript
interface ChatStore {
  // Connection state
  connected: boolean;
  subscribed: boolean;

  // Agent state (from SSE)
  status: 'running' | 'stable' | 'unknown';
  agentType: string;

  // Messages (from SSE)
  messages: ChatMessage[];

  // Raw screen (from SSE)
  rawScreen: string;
  showRawScreen: boolean;

  // Input state
  inputText: string;
  isSending: boolean;

  // Actions
  subscribe: (processId: string) => void;
  unsubscribe: () => void;
  sendMessage: (content: string) => Promise<void>;
  sendRaw: (content: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  setInputText: (text: string) => void;
  toggleRawScreen: () => void;

  // Event handlers (called by WebSocket handler)
  handleMessageUpdate: (event: MessageUpdateEvent) => void;
  handleStatusChange: (event: StatusChangeEvent) => void;
  handleScreenUpdate: (event: ScreenUpdateEvent) => void;
}
```

### Message Update Handling

```typescript
handleMessageUpdate: (event) => {
  set((state) => {
    const existingIndex = state.messages.findIndex(m => m.id === event.id);
    const newMessage: ChatMessage = {
      id: event.id,
      role: event.role,
      content: event.message,
      time: new Date(event.time),
      isStreaming: state.status === 'running' && event.role === 'agent',
    };

    if (existingIndex >= 0) {
      // Update existing message (streaming update)
      const newMessages = [...state.messages];
      newMessages[existingIndex] = newMessage;
      return { messages: newMessages };
    } else {
      // New message
      return { messages: [...state.messages, newMessage] };
    }
  });
}
```

---

## WebSocket Protocol Extensions

### New Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `chat_subscribe` | App → Bridge | Subscribe to chat events for process |
| `chat_unsubscribe` | App → Bridge | Unsubscribe from chat events |
| `chat_send` | App → Bridge | Send user message |
| `chat_raw` | App → Bridge | Send raw keystrokes |
| `chat_upload` | App → Bridge | Upload file |
| `chat_event` | Bridge → App | SSE event forwarded |
| `chat_screen` | App → Bridge | Request current raw screen |
| `chat_screen_result` | Bridge → App | Raw screen content |

### Payload Definitions

```typescript
// Subscribe to chat events
interface ChatSubscribePayload {
  processId: string;
}

// Send user message
interface ChatSendPayload {
  processId: string;
  content: string;
}

// Send raw keystrokes
interface ChatRawPayload {
  processId: string;
  content: string;  // e.g., "\x03" for Ctrl+C
}

// Upload file
interface ChatUploadPayload {
  processId: string;
  filename: string;
  content: string;  // Base64 encoded
}

// Chat event (forwarded from SSE)
interface ChatEventPayload {
  processId: string;
  event: 'message_update' | 'status_change' | 'screen_update';
  data: MessageUpdateData | StatusChangeData | ScreenUpdateData;
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

interface ScreenUpdateData {
  screen: string;  // Raw terminal content
}

// Request raw screen
interface ChatScreenPayload {
  processId: string;
}

// Raw screen result
interface ChatScreenResultPayload {
  processId: string;
  screen: string;
}
```

---

## UI Behavior Rules

### Input Field

| Agent Status | Input Enabled | Send Button | Placeholder Text |
|--------------|---------------|-------------|------------------|
| `stable` | Yes | Enabled | "Type a message..." |
| `running` | No | Disabled | "Claude is working..." |
| Disconnected | No | Disabled | "Reconnecting..." |

### Message Streaming

When `status=running` and we receive `message_update` for an agent message:
1. Find message by ID
2. Update content (may be partial)
3. Show streaming indicator (pulsing cursor)
4. Auto-scroll to bottom

When `status` changes to `stable`:
1. Remove streaming indicator from last message
2. Re-enable input field
3. Focus input field

### Interrupt Handling (Critical for Agent Control)

The ability to interrupt a running agent is **essential**. Unlike `user` messages which are rejected when the agent is busy, `raw` messages are **always accepted** by AgentAPI.

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERRUPTING THE AGENT                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Agent Status: RUNNING (busy processing)                         │
│                                                                  │
│  ❌ Send user message  → REJECTED (agent busy)                   │
│  ✅ Send raw message   → ACCEPTED (always works)                 │
│                                                                  │
│  Use [Ctrl+C] or [Esc] buttons to interrupt!                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Escape Key** (`\x1b`):
- Sends escape sequence via `raw` message
- Often cancels current input or exits prompts
- Safe to spam - won't harm the agent

**Ctrl+C** (`\x03`):
- Sends SIGINT via `raw` message
- **Primary method to interrupt a running agent**
- Use when agent is stuck or taking too long
- Agent will stop current operation and return to `stable` status

**Ctrl+D** (`\x04`):
- Sends EOF via `raw` message
- Can exit Claude Code entirely
- Show confirmation dialog first (dangerous action)

**Implementation Note:**
```typescript
// Interrupt buttons should ALWAYS be enabled
// They use chat_raw which bypasses the status check
const handleInterrupt = (key: '\x03' | '\x1b') => {
  // No status check needed - raw messages always work
  sendMessage({
    type: 'chat_raw',
    payload: { hostId, content: key }
  });
};
```

### File Upload

1. User taps attachment button
2. File picker opens
3. User selects file (max 10MB)
4. App sends `chat_upload` with base64 content
5. Bridge calls `POST /upload`
6. Response includes file path
7. **Show toast/banner with file path** so user can reference it
8. User can copy path and paste in next message

```typescript
// Response format
interface UploadResponse {
  files: Array<{
    name: string;    // Original filename
    path: string;    // Server path to reference
    size: number;    // File size in bytes
  }>;
}
```

**UI after upload:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ✓ File uploaded: config.json                                    │
│   Path: /tmp/agentapi-uploads/abc123/config.json    [Copy Path] │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Send Message Errors

| Error | Cause | User Action |
|-------|-------|-------------|
| `status=running` | Agent busy | Wait or send interrupt |
| `empty message` | Blank input | Type something |
| `whitespace` | Leading/trailing spaces | Auto-trim before send |
| Network error | Connection lost | Auto-retry with backoff |

### SSE Connection Errors

```typescript
// Reconnection logic
const reconnect = async () => {
  let delay = 1000;  // Start at 1 second
  const maxDelay = 30000;  // Max 30 seconds

  while (!connected) {
    try {
      await subscribe(processId);
      delay = 1000;  // Reset on success
    } catch (err) {
      console.error('SSE reconnect failed:', err);
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
};
```

### Stale Message Detection

If we receive a `message_update` with an ID lower than our last message:
- This is a historical message (from initial SSE connection)
- Don't show as "new" message
- Just update/add to list

---

## Raw Screen Modal

The "View Raw Screen" feature shows the unprocessed terminal output:

```
┌─────────────────────────────────────────────────────────────────┐
│  Raw Terminal Screen                                    [Close] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ╭─────────────────────────────────────────────────────────────╮│
│  │ Claude Code                                                 ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │  I'll help you implement that feature.                      ││
│  │                                                             ││
│  │  Let me start by examining the codebase...                  ││
│  │                                                             ││
│  │  > Reading src/components/Settings.tsx                      ││
│  │  > Reading src/styles/theme.ts                              ││
│  │                                                             ││
│  │  ────────────────────────────────────────────────────────── ││
│  │  ? What would you like me to do next?                       ││
│  │  > _                                                        ││
│  │                                                             ││
│  ╰─────────────────────────────────────────────────────────────╯│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

This is useful for:
- Seeing exact TUI layout
- Debugging message parsing issues
- Viewing progress indicators
- Seeing tool execution details

---

## Performance Considerations

### Message Update Frequency

AgentAPI sends `message_update` events frequently during streaming.
To avoid UI jank:

```typescript
// Throttle message updates to 100ms
const throttledUpdate = throttle((event: MessageUpdateEvent) => {
  store.handleMessageUpdate(event);
}, 100);
```

### Screen Update Frequency

`screen_update` events are ONLY available on `/internal/screen` endpoint (not `/events`).
Use sparingly:
- For raw terminal view modal
- For pattern detection (tool usage, etc.)

### Message List Virtualization

For long conversations, use virtualized list:
- Only render visible messages
- Recycle message components
- Maintain scroll position on updates

### Auto-Scroll Logic

```typescript
const checkIfAtBottom = useCallback(() => {
  if (!scrollAreaRef) return false;
  const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef;
  // 10px tolerance for "at bottom" detection
  return scrollTop + clientHeight >= scrollHeight - 10;
}, [scrollAreaRef]);

// Auto-scroll conditions:
// 1. User is already at bottom (following along)
// 2. User just sent a message (want to see response)
// 3. NOT if user scrolled up to read history
```

### Loading Indicator

When agent is typing but message is empty, show loading dots:

```typescript
{message.role === 'agent' && message.content === '' && status === 'running' && (
  <span className="loading-dots">...</span>
)}
```

---

## Accessibility

- **Screen reader**: Announce new messages
- **Voice input**: Support dictation for message input
- **High contrast**: Support dark/light themes
- **Large text**: Scale message text with system settings
- **Haptic feedback**: Vibrate on message received (optional)

---

## Future Enhancements

1. **Message search**: Search conversation history
2. **Message reactions**: Quick reactions to agent messages
3. **Code blocks**: Syntax highlighting for code in messages
4. **Image attachments**: Upload and display images
5. **Voice messages**: Record and send audio
6. **Message bookmarks**: Save important messages
7. **Export conversation**: Save as markdown/JSON
8. **Multi-session view**: See multiple Claude sessions side-by-side

---

## Best Practices for AgentAPI Interaction

### Message Sending Rules

1. **Check status before sending `user` messages** - only allowed when `stable`
2. **`raw` messages can be sent anytime** - use for interrupts (Ctrl+C, Escape)
3. **File upload limit is 10MB**

### On-Demand Data Fetching

Use these endpoints to refresh data without relying solely on SSE:

| Endpoint | Use Case | UI Trigger |
|----------|----------|------------|
| `GET /status` | Check if agent is ready | On app foreground, reconnect |
| `GET /messages` | Fetch full history | Pull-to-refresh, initial load |

### SSE Event Handling

- `/events` provides `message_update` and `status_change`
- `/internal/screen` provides raw `screen_update` (use sparingly)
- Implement reconnection with exponential backoff

### Auto-Scroll UX

- Track if user is at bottom (10px tolerance)
- Only auto-scroll if: at bottom OR user just sent message
- Never interrupt user reading history

### Control Mode (Direct Terminal Access)

Send keystrokes via `raw` message type:

**Navigation Keys:**
| Key | Escape Sequence | Description |
|-----|-----------------|-------------|
| Arrow Up | `\x1b[A` | Previous command / move up |
| Arrow Down | `\x1b[B` | Next command / move down |
| Arrow Right | `\x1b[C` | Move cursor right |
| Arrow Left | `\x1b[D` | Move cursor left |
| Home | `\x1b[H` | Beginning of line |
| End | `\x1b[F` | End of line |
| Page Up | `\x1b[5~` | Scroll up |
| Page Down | `\x1b[6~` | Scroll down |

**Editing Keys:**
| Key | Escape Sequence | Description |
|-----|-----------------|-------------|
| Tab | `\t` | Autocomplete |
| Backspace | `\b` | Delete char before cursor |
| Delete | `\x1b[3~` | Delete char at cursor |
| Enter | `\r` | Submit / newline |
| Escape | `\x1b` | Cancel / exit |

**Control Combinations:**
| Key | Escape Sequence | Description |
|-----|-----------------|-------------|
| Ctrl+C | `\x03` | Interrupt (SIGINT) |
| Ctrl+D | `\x04` | EOF / exit |
| Ctrl+Z | `\x1a` | Suspend (SIGTSTP) |
| Ctrl+L | `\x0c` | Clear screen |
| Ctrl+A | `\x01` | Beginning of line |
| Ctrl+E | `\x05` | End of line |
| Ctrl+W | `\x17` | Delete word backward |
| Ctrl+U | `\x15` | Delete entire line |
| Ctrl+K | `\x0b` | Delete to end of line |
| Ctrl+R | `\x12` | Reverse history search |
| Ctrl+N | `\x0e` | Next history |
| Ctrl+P | `\x10` | Previous history |

### Error Prevention

1. **Never send `user` messages while `running`** - will be rejected
2. **`screen_update` is NOT on `/events`** - use `/internal/screen`
3. **Don't expect structured tool data** - only formatted text available
