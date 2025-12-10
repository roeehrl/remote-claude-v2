# Remote Claude V2 - Architecture Documentation

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Mobile App (React Native)                    │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Terminal   │  │    Chat     │  │  Process    │  │  Settings   │ │
│  │    Tab      │  │    Tab      │  │    List     │  │    Tab      │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                                  │                                   │
│                          WebSocket Client                            │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │
                            WebSocket (wss://)
                                   │
┌──────────────────────────────────┼───────────────────────────────────┐
│                           Bridge Service (Go)                        │
├──────────────────────────────────┴───────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     WebSocket Handler                           │ │
│  │  - Session management                                           │ │
│  │  - Message routing                                              │ │
│  │  - Protocol handling                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                  │                                   │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     Process Manager                              │ │
│  │  - Track all shells (PTYs)                                      │ │
│  │  - Track AgentAPI instances                                     │ │
│  │  - Port allocation (3284-3299)                                  │ │
│  │  - Session persistence across reconnects                        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                  │                                   │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────────┐ │
│  │   SSH Client     │  │   AgentAPI Client  │  │   Port Scanner   │ │
│  │  - PTY sessions  │  │  - HTTP API calls  │  │  - Detect stale  │ │
│  │  - Port forward  │  │  - SSE streaming   │  │    servers       │ │
│  │  - Tunnel for    │  │  - Uses SSH tunnel │  │  - Via SSH       │ │
│  │    AgentAPI      │  │    (no direct HTTP)│  │                  │ │
│  └────────┬─────────┘  └─────────┬──────────┘  └────────┬─────────┘ │
└───────────┼──────────────────────┼──────────────────────┼────────────┘
            │                      │                      │
            │         ALL traffic goes through SSH        │
            │                   (port 22)                 │
            │                      │                      │
┌───────────┴──────────────────────┴──────────────────────┴────────────┐
│                         Remote Host (Linux VM)                        │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      PTY Sessions (SSH)                         │ │
│  │                                                                 │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │ │
│  │  │ PTY 1       │  │ PTY 2       │  │ PTY 3       │              │ │
│  │  │ Type: Shell │  │ Type: Claude│  │ Type: Claude│              │ │
│  │  │ bash prompt │  │ agentapi    │  │ agentapi    │              │ │
│  │  │             │  │ attach:3284 │  │ attach:3285 │              │ │
│  │  └─────────────┘  └──────┬──────┘  └──────┬──────┘              │ │
│  └───────────────────────────┼───────────────┼─────────────────────┘ │
│                              │               │                       │
│  ┌───────────────────────────┼───────────────┼─────────────────────┐ │
│  │                    AgentAPI Servers (localhost only)            │ │
│  │                           │               │                     │ │
│  │              ┌────────────▼──┐  ┌─────────▼────┐                │ │
│  │              │ Port 3284     │  │ Port 3285    │  ...           │ │
│  │              │ CWD: /home    │  │ CWD: /project│                │ │
│  │              │ Claude Code   │  │ Claude Code  │                │ │
│  │              └───────────────┘  └──────────────┘                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## Process Types

### 1. Shell Process (PTY Only)
- Pure terminal session via SSH
- No AgentAPI integration
- Used for general shell commands
- **Can be converted to Claude process** (see below)

### 2. Claude Process (PTY + AgentAPI)
- Started via `agentapi server --port {port} -- claude`
- User attaches via `agentapi attach --url localhost:{port}`
- PTY shows the TUI (same as shell, but running Claude Code)
- AgentAPI provides programmatic access to the same session
- Terminal Tab and Chat Tab share the SAME session

### Process Conversion: Shell ↔ Claude

**Shell → Claude** (user clicks "Claude" button):
1. The **same PTY** is used - commands are typed into it
2. Shell becomes a Claude process (type changes from "shell" to "claude")
3. The PTY now shows Claude Code's TUI (via `agentapi attach`)
4. The shell is **no longer available** as a general shell

**Claude → Shell** (user kills Claude process):
1. Bridge sends SIGTERM to `agentapi server` process (by PID)
2. AgentAPI server shuts down
3. `agentapi attach` exits automatically (server gone)
4. PTY returns to shell prompt (bash/zsh)
5. Process type reverts from "claude" to "shell"
6. User can use it as a normal shell again

```
┌─────────────────┐                    ┌─────────────────┐
│  Shell Process  │  ── Claude btn ──> │ Claude Process  │
│                 │                    │                 │
│  PTY: bash      │                    │  PTY: agentapi  │
│  AgentAPI: none │ <── Kill Claude ── │       attach    │
│                 │                    │  AgentAPI: :3284│
└─────────────────┘                    └─────────────────┘
     (general shell)                    (Claude Code TUI)
```

**Note**: The Bridge must track the AgentAPI server's PID to kill it properly.

## Connection Architecture

The app has TWO separate connection layers:

### Layer 1: App ↔ Bridge (WebSocket)
- Mobile app connects to Bridge service via WebSocket
- User configures: Bridge URL (e.g., `ws://192.168.1.100:8080/ws`)
- This is configured ONCE in app settings
- Bridge can run anywhere accessible to the mobile app

### Layer 2: Bridge ↔ SSH Hosts
- Bridge connects to remote hosts via SSH
- User configures: SSH host, port (22), username, password/key
- Multiple SSH hosts can be configured
- Each SSH host runs Claude Code

### Deployment Scenarios

**Scenario A: Single Host (Bridge + SSH on same machine)**
```
┌──────────┐    WebSocket     ┌─────────────────────────────┐
│ Mobile   │ ───────────────> │ Host (192.168.1.100)        │
│ App      │    :8080/ws      │                             │
└──────────┘                  │  ┌─────────┐  ┌───────────┐ │
                              │  │ Bridge  │─>│ SSH (:22) │ │
                              │  │ (:8080) │  │ Claude    │ │
                              │  └─────────┘  └───────────┘ │
                              └─────────────────────────────┘

User configures:
- Bridge URL: ws://192.168.1.100:8080/ws
- SSH Host: localhost:22 (or 192.168.1.100:22)
```

**Scenario B: Separate Hosts (Dedicated Bridge)**
```
┌──────────┐   WebSocket    ┌──────────┐    SSH     ┌──────────┐
│ Mobile   │ ─────────────> │ Bridge   │ ────────── │ Claude   │
│ App      │   :8080/ws     │ Server   │    :22     │ Host     │
└──────────┘                └──────────┘            └──────────┘
                            192.168.1.50            192.168.1.100

User configures:
- Bridge URL: ws://192.168.1.50:8080/ws
- SSH Host: 192.168.1.100:22
```

**Scenario C: Multiple Claude Hosts**
```
┌──────────┐   WebSocket    ┌──────────┐    SSH     ┌──────────┐
│ Mobile   │ ─────────────> │ Bridge   │ ────────── │ Host A   │
│ App      │   :8080/ws     │ Server   │ ─┐  :22    └──────────┘
└──────────┘                └──────────┘  │
                                          │  SSH     ┌──────────┐
                                          └──────────│ Host B   │
                                               :22   └──────────┘

User configures:
- Bridge URL: ws://bridge.example.com:8080/ws
- SSH Host A: host-a.example.com:22
- SSH Host B: host-b.example.com:22
```

## User Flows

### Flow 0: Configure Bridge (One-time Setup)
```
1. User opens Settings Tab
2. User enters Bridge URL: ws://{bridge-host}:{port}/ws
3. App saves Bridge URL
4. App connects to Bridge via WebSocket
5. Bridge → App: auth_result(success, session_id)
```

### Flow 1: Add SSH Host
```
1. User opens Settings Tab → "Add Host"
2. User enters:
   - Name: "My Server"
   - SSH Host: 192.168.1.100
   - SSH Port: 22
   - Username: user
   - Auth: password or private key
3. App saves host configuration locally
4. App → Bridge: host_connect(host, port, username, credentials)
5. Bridge establishes SSH connection to remote host
6. Bridge scans ports 3284-3299 for existing AgentAPI servers
7. Bridge → App: host_status(host_id, connected, existing_processes[])
8. App displays process list for this host
```

### Flow 2: Start New Shell
```
1. User taps "New Shell" button
2. App → Bridge: process_create(type: "shell")
3. Bridge creates new PTY session
4. Bridge → App: process_created(id, type: "shell", pty_ready: true)
5. User can now use Terminal Tab
```

### Flow 3: Start Claude Code (Convert Shell → Claude)
```
1. User has an existing shell process selected
2. User taps "Claude" button on that shell
3. App → Bridge: claude_start(process_id)
4. Bridge:
   a. Allocates port from pool (3284-3299)
   b. Types into PTY: agentapi server --port {port} -- claude &
   c. Captures PID of agentapi server from output
   d. Types into PTY: agentapi attach --url localhost:{port}
   e. Updates process type: "shell" → "claude"
   f. Connects AgentAPI client via SSH tunnel
5. Bridge → App: process_updated(id, type: "claude", port: {port}, agentapi_ready: true)
6. User can now use both Terminal Tab AND Chat Tab
```

**Note**: There is NO way to create a Claude process directly. User must first create a shell (Flow 2), then convert it to Claude (Flow 3).

### Flow 4: Using Terminal Tab
```
1. User types in terminal
2. App → Bridge: pty_input(process_id, data)
3. Bridge writes to PTY stdin
4. PTY output → Bridge → App: pty_output(process_id, data)
5. App renders terminal output
```

### Flow 5: Using Chat Tab
```
1. User types message
2. App → Bridge: chat_send(process_id, content, type: "user")
3. Bridge → AgentAPI: POST /message {role: "user", content: "..."}
4. AgentAPI → Bridge (SSE): message_update events
5. Bridge → App: chat_event(process_id, event)
6. App updates chat UI
```

### Flow 6: Reconnection
```
1. App reconnects after disconnect
2. App → Bridge: host_connect(...)
3. Bridge scans ports 3284-3299
4. For each port with AgentAPI server:
   a. Try GET /status
   b. If success: add to existing_processes
   c. If fail: mark as stale
5. Bridge → App: host_status(connected, existing_processes[], stale_processes[])
6. App prompts user about stale processes
7. User can kill stale processes via process_kill
```

### Flow 7: Switch Between Sessions
```
1. User has multiple Claude processes (different ports)
2. User taps on different process in list
3. App → Bridge: process_select(process_id)
4. App updates Terminal Tab (switches PTY)
5. App updates Chat Tab (switches AgentAPI connection)
```

### Flow 8: Kill Claude (Convert Back to Shell)
```
1. User taps "Kill Claude" on a Claude process
2. App → Bridge: claude_kill(process_id)
3. Bridge:
   a. Looks up AgentAPI server PID for this process
   b. Sends SIGTERM to PID via PTY: kill {pid}
   c. Waits for agentapi attach to exit
   d. Updates process type: "claude" → "shell"
   e. Releases port back to pool
4. Bridge → App: process_updated(id, type: "shell", port: null, agentapi_ready: false)
5. PTY now shows shell prompt
6. User can use Terminal Tab as normal shell
7. Chat Tab is disabled for this process
```

## Bridge State Management

### Process Registry
```go
type ProcessRegistry struct {
    mu        sync.RWMutex
    processes map[string]*Process
}

type Process struct {
    ID           string
    Type         ProcessType  // "shell" or "claude"
    PTY          *pty.Session
    AgentAPI     *AgentAPIConnection
    Port         int          // 0 for shell, 3284-3299 for claude
    CWD          string
    StartedAt    time.Time
    PID          int          // AgentAPI server PID
}
```

### Port Allocation
```go
const (
    MinPort = 3284
    MaxPort = 3299
)

func (r *ProcessRegistry) AllocatePort() (int, error) {
    r.mu.Lock()
    defer r.mu.Unlock()

    usedPorts := make(map[int]bool)
    for _, p := range r.processes {
        if p.Port > 0 {
            usedPorts[p.Port] = true
        }
    }

    for port := MinPort; port <= MaxPort; port++ {
        if !usedPorts[port] {
            return port, nil
        }
    }

    return 0, errors.New("no available ports")
}
```

## WebSocket Protocol

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | App → Bridge | Authenticate session |
| `auth_result` | Bridge → App | Auth response |
| `host_connect` | App → Bridge | Connect to remote host |
| `host_disconnect` | App → Bridge | Disconnect from host |
| `host_status` | Bridge → App | Connection status update |
| `process_list` | App → Bridge | Request process list |
| `process_list_result` | Bridge → App | List of all processes |
| `process_create` | App → Bridge | Create new process |
| `process_created` | Bridge → App | Process created |
| `process_select` | App → Bridge | Switch active process |
| `process_kill` | App → Bridge | Kill a process (closes PTY entirely) |
| `process_updated` | Bridge → App | Process state changed |
| `claude_start` | App → Bridge | Convert shell to Claude process |
| `claude_kill` | App → Bridge | Kill AgentAPI, revert to shell |
| `pty_input` | App → Bridge | Terminal input |
| `pty_output` | Bridge → App | Terminal output |
| `pty_resize` | App → Bridge | Terminal resize |
| `chat_send` | App → Bridge | Send chat message |
| `chat_raw` | App → Bridge | Send raw keystrokes |
| `chat_event` | Bridge → App | Chat event (SSE forwarded) |
| `chat_status` | App → Bridge | Request agent status |
| `chat_status_result` | Bridge → App | Agent status response |
| `chat_history` | App → Bridge | Request message history |
| `chat_messages` | Bridge → App | Message history response |
| `error` | Bridge → App | Error notification |

### Message Format
```typescript
interface Message {
  type: MessageType;
  payload: unknown;
  timestamp: number;
}
```

### Key Payloads

```typescript
// Process Creation (shell only - use claude_start to convert)
interface ProcessCreatePayload {
  cwd?: string;  // Optional working directory
}

interface ProcessCreatedPayload {
  id: string;
  type: "shell";  // Always shell on creation
  cwd: string;
  ptyReady: boolean;
}

// Process List
interface ProcessListResultPayload {
  processes: Process[];
}

interface Process {
  id: string;
  type: "shell" | "claude";
  port?: number;
  cwd: string;
  ptyReady: boolean;
  agentApiReady: boolean;
  startedAt: string;  // ISO timestamp
}

// Host Status (with existing processes)
interface HostStatusPayload {
  hostId: string;
  connected: boolean;
  processes: Process[];
  staleProcesses?: StaleProcess[];  // Detected but not connectable
  error?: string;
}

interface StaleProcess {
  port: number;
  reason: string;  // "connection_refused", "timeout", etc.
}

// Claude Start (convert shell to Claude)
interface ClaudeStartPayload {
  processId: string;  // Must be an existing shell process
}

// Claude Kill (revert to shell)
interface ClaudeKillPayload {
  processId: string;
}

// Process Updated (state change notification)
interface ProcessUpdatedPayload {
  id: string;
  type: "shell" | "claude";
  port?: number;       // null when reverted to shell
  ptyReady: boolean;
  agentApiReady: boolean;  // false when reverted to shell
}
```

## AgentAPI Integration

### SSH Tunnel Requirement

**CRITICAL**: AgentAPI has NO authentication. It only listens on `localhost` on the remote host. All HTTP connections to AgentAPI MUST go through the SSH tunnel.

```
┌─────────────────┐     SSH Tunnel      ┌─────────────────┐
│  Bridge Service │ ==================> │   Remote Host   │
│                 │                     │                 │
│  HTTP Client ───┼── localhost:3284 ──>│── localhost:3284│──> AgentAPI
│                 │   (forwarded)       │   (actual)      │
└─────────────────┘                     └─────────────────┘
```

The Bridge establishes an SSH connection first, then creates a local port forward:
- Local: `127.0.0.1:{localPort}` on Bridge
- Remote: `127.0.0.1:{agentApiPort}` on Remote Host

All AgentAPI HTTP requests use this tunnel via a custom `http.Transport` with `DialContext` pointing to the SSH connection's `Dial` method.

### HTTP Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Get agent status (running/stable) |
| `/messages` | GET | Get conversation history |
| `/message` | POST | Send user message |
| `/upload` | POST | Upload file attachment |
| `/events` | GET | SSE stream for real-time updates |

### SSE Events

```typescript
// message_update - New or updated message
{
  event: "message_update",
  data: {
    id: string,
    role: "user" | "assistant",
    message: string,
    time: string
  }
}

// status_change - Agent status changed
{
  event: "status_change",
  data: {
    status: "running" | "stable",
    agent_type: string
  }
}
```

### Message Types

- **User Message** (`chat_send`): Logged message, shows in history
- **Raw Keystroke** (`chat_raw`): Direct input like Ctrl+C, not logged

## Mobile App Components

### Tabs
1. **Terminal Tab**: Full PTY terminal emulator
2. **Chat Tab**: Programmatic chat interface (or empty state for shells)
3. **Process List**: Shows all shells and Claude instances
4. **Settings Tab**: Host management

### Chat Tab States

The Chat Tab content depends on the selected process type:

**When Claude process is selected:**
- Full chat interface with message history
- Input bar for sending messages
- Streaming indicator when Claude is responding

**When Shell process is selected:**
```
┌─────────────────────────────────────┐
│                                     │
│         [Shell Icon]                │
│                                     │
│    This is a shell session.         │
│    Start Claude to enable chat.     │
│                                     │
│    ┌─────────────────────────┐      │
│    │    Start Claude Code    │      │
│    └─────────────────────────┘      │
│                                     │
└─────────────────────────────────────┘
```

**When no process is selected:**
```
┌─────────────────────────────────────┐
│                                     │
│      No process selected.           │
│      Select a process from the      │
│      list to get started.           │
│                                     │
└─────────────────────────────────────┘
```

### Stores (Zustand)
- `processStore`: Process registry, active process selection
- `terminalStore`: PTY buffer, cursor state
- `chatStore`: Message history, streaming state
- `hostStore`: Host configurations, connection state

### Key Components
- `TerminalView`: xterm.js based terminal
- `ChatView`: Message list with streaming support
- `ProcessList`: List of all processes with actions
- `HostSettings`: Add/edit/delete hosts

## Error Handling

### Connection Errors
- SSH connection failure → Retry with backoff
- AgentAPI not responding → Mark as stale, prompt user

### Process Errors
- Port already in use → Try next available port
- AgentAPI crash → Detect via PTY output, update status

### Recovery
- On reconnect, scan for existing servers
- Prompt user to kill stale processes
- Re-establish PTY connections where possible

## Configuration

### Environment Variables (Bridge Service)
```bash
BRIDGE_PORT=8080
LOG_LEVEL=debug

# AgentAPI Defaults
AGENTAPI_PORT_MIN=3284
AGENTAPI_PORT_MAX=3299
```

### App Configuration (stored locally on device)

```typescript
// Bridge connection (one per app)
interface BridgeConfig {
  url: string;  // WebSocket URL, e.g., "ws://192.168.1.100:8080/ws"
}

// SSH Host configuration (multiple hosts supported)
interface SSHHostConfig {
  id: string;
  name: string;           // Display name, e.g., "My Dev Server"
  host: string;           // SSH host, e.g., "192.168.1.100"
  port: number;           // SSH port, default 22
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
}

// Full app config
interface AppConfig {
  bridge: BridgeConfig;
  sshHosts: SSHHostConfig[];
}
```

### Settings Tab Structure
```
Settings
├── Bridge Connection
│   └── URL: ws://192.168.1.100:8080/ws  [Edit]
│
└── SSH Hosts
    ├── [+] Add Host
    ├── My Dev Server (192.168.1.100) [Edit] [Delete]
    └── Production (prod.example.com) [Edit] [Delete]
```
