# Remote Claude V2 - Implementation Plan

This document provides a complete, phase-by-phase implementation plan for building the Remote Claude V2 monorepo system.

## Verification Process

**IMPORTANT**: After completing each phase, perform a design alignment check:
1. Review the relevant sections of ARCHITECTURE.md, APP.md, CHAT.md, and BRIDGE-AGENTAPI.md
2. Check the phase-specific verification checklist below
3. Ensure nothing was missed before moving to the next phase
4. At the end of Phase 13, perform a comprehensive audit of ALL design documents

---

## System Overview

```
┌──────────────┐   WebSocket    ┌──────────────┐     SSH      ┌──────────────┐
│  Mobile App  │ ─────────────> │    Bridge    │ ───────────> │  SSH Host    │
│  (Expo RN)   │   (Layer 1)    │   (Go)       │   (Layer 2)  │  (Linux VM)  │
└──────────────┘                └──────────────┘              └──────────────┘
```

**Components:**
- **Mobile App**: Expo React Native (iOS, Android, Web)
- **Bridge Service**: Go server proxying WebSocket to SSH/AgentAPI
- **Remote Host**: Linux VM running Claude Code via AgentAPI

**Process Types:**
- **Shell**: Pure PTY session (no AgentAPI)
- **Claude**: PTY + AgentAPI (converted from shell)

---

## Phase 1: Project Foundation & Monorepo Setup

### Objective
Initialize the monorepo structure with all required packages and tooling.

### Tasks

1. **Initialize pnpm monorepo with workspaces**
   ```yaml
   # pnpm-workspace.yaml
   packages:
     - 'apps/*'
     - 'services/*'
     - 'packages/*'
   ```

2. **Create apps/mobile Expo project**
   ```bash
   cd apps
   npx create-expo-app mobile --template expo-template-blank-typescript
   npx expo install expo-router
   ```

3. **Create services/bridge Go module**
   ```bash
   cd services/bridge
   go mod init github.com/roeeharel/remote-claude-v2/services/bridge
   ```

   Directory structure:
   ```
   services/bridge/
   ├── cmd/bridge/main.go
   ├── internal/
   │   ├── server/       # WebSocket server
   │   ├── ssh/          # SSH client
   │   ├── agentapi/     # AgentAPI client
   │   ├── process/      # Process registry
   │   └── protocol/     # Message types
   └── go.mod
   ```

4. **Create packages/shared-types**
   ```
   packages/shared-types/
   ├── src/
   │   ├── messages.ts   # All message type definitions
   │   ├── payloads.ts   # Payload interfaces
   │   └── index.ts
   ├── package.json
   └── tsconfig.json
   ```

5. **Set up protocol alignment tests**
   - TypeScript: `apps/mobile/lib/__tests__/protocol-alignment.test.ts`
   - Go: `services/bridge/protocol/alignment_test.go`
   - Tests verify message type strings and JSON field names match exactly

### Deliverables
- [ ] Working monorepo with pnpm workspaces
- [ ] Expo app skeleton with routing
- [ ] Go module with directory structure
- [ ] Shared types package
- [ ] Protocol alignment test framework

### Phase 1 Verification Checklist
**Docs to check**: ARCHITECTURE.md (System Overview), APP.md (File Structure)
- [ ] Monorepo structure matches APP.md file structure
- [ ] All packages exist: apps/mobile, services/bridge, packages/shared-types
- [ ] Protocol alignment test framework is set up per CLAUDE.md requirement

---

## Phase 2: WebSocket Protocol & Bridge Core

### Objective
Define all protocol messages and implement the WebSocket server foundation.

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | App → Bridge | Authenticate session |
| `auth_result` | Bridge → App | Auth response |
| `host_connect` | App → Bridge | Connect to SSH host |
| `host_disconnect` | App → Bridge | Disconnect from host |
| `host_status` | Bridge → App | Connection status |
| `process_create` | App → Bridge | Create shell process |
| `process_created` | Bridge → App | Process created |
| `process_kill` | App → Bridge | Kill process |
| `process_updated` | Bridge → App | Process state changed |
| `claude_start` | App → Bridge | Convert shell → Claude |
| `claude_kill` | App → Bridge | Revert Claude → shell |
| `pty_input` | App → Bridge | Terminal input |
| `pty_output` | Bridge → App | Terminal output |
| `pty_resize` | App → Bridge | Terminal resize |
| `chat_subscribe` | App → Bridge | Subscribe to chat events |
| `chat_send` | App → Bridge | Send user message |
| `chat_raw` | App → Bridge | Send raw keystrokes |
| `chat_event` | Bridge → App | SSE event forwarded |
| `error` | Bridge → App | Error notification |

### Tasks

1. **Define TypeScript message types** (packages/shared-types)
2. **Define Go message types** (services/bridge/protocol)
3. **Implement WebSocket server** (gorilla/websocket)
4. **Implement session management**
5. **Implement message routing**
6. **Write protocol alignment tests**

### Debug Logging
```go
// Bridge: Log all messages
func (s *Server) handleMessage(msg *Message) {
    log.Printf("[WS] Received: type=%s payload=%+v", msg.Type, msg.Payload)
    // ... handle message
    log.Printf("[WS] Sending: type=%s payload=%+v", response.Type, response.Payload)
}
```

```typescript
// App: Log all messages
const sendMessage = (msg: Message) => {
  console.log('[WS] Sending:', msg.type, msg.payload);
  ws.send(JSON.stringify(msg));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('[WS] Received:', msg.type, msg.payload);
};
```

### Deliverables
- [ ] All message types defined in TS and Go
- [ ] Protocol alignment tests passing
- [ ] WebSocket server accepting connections
- [ ] Session management working

### Phase 2 Verification Checklist
**Docs to check**: ARCHITECTURE.md (WebSocket Protocol), APP.md (WebSocket Communication), BRIDGE-AGENTAPI.md (Message Types)
- [ ] All 20+ message types from ARCHITECTURE.md are implemented
- [ ] Message payloads match the Key Payloads section exactly
- [ ] Session management supports reconnection
- [ ] Protocol alignment tests pass in BOTH TypeScript and Go

---

## Phase 3: SSH Client & PTY Management

### Objective
Implement SSH connections and PTY session management.

### Tasks

1. **SSH client connection manager**
   - Password and private key authentication
   - Connection pooling per host
   - Error handling with retry

2. **PTY session management**
   - Create PTY via SSH
   - Bidirectional I/O streaming
   - Resize handling

3. **SSH port forwarding**
   ```go
   // CRITICAL: All AgentAPI calls must go through SSH tunnel
   func (c *Connection) getTunneledHTTPClient() *http.Client {
       return &http.Client{
           Transport: &http.Transport{
               DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
                   return c.sshClient.Dial(network, addr)
               },
           },
       }
   }
   ```

4. **Process Registry**
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
       ShellPID     int          // Shell process PID
       AgentAPIPID  int          // AgentAPI server PID (claude only)
   }
   ```

5. **Port allocation** (3284-3299, 16 ports max)

6. **Port scanner for existing servers**

7. **Message handlers**: host_connect, host_disconnect, process_create, process_kill

### Deliverables
- [ ] SSH connections working
- [ ] PTY sessions with I/O
- [ ] Port forwarding tunnels
- [ ] Process registry with port allocation

### Phase 3 Verification Checklist
**Docs to check**: ARCHITECTURE.md (Process Types, Bridge State Management, Connection Architecture)
- [ ] ProcessRegistry struct matches Go code in ARCHITECTURE.md
- [ ] Port allocation uses MinPort=3284, MaxPort=3299
- [ ] SSH tunnel is used for ALL AgentAPI traffic (CRITICAL)
- [ ] PTY sessions support resize
- [ ] Port scanning detects existing AgentAPI servers on reconnection

---

## Phase 4: AgentAPI Integration

### Objective
Implement AgentAPI client for Claude process management.

### AgentAPI Endpoints (via SSH tunnel)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Agent status (running/stable) |
| `/messages` | GET | Conversation history |
| `/message` | POST | Send message (user/raw) |
| `/upload` | POST | Upload file (10MB max) |
| `/events` | GET | SSE stream |
| `/internal/screen` | GET | Raw screen SSE |

### Tasks

1. **HTTP client via SSH tunnel**
2. **SSE client for events streaming**
3. **claude_start handler**:
   ```
   1. Allocate port from pool
   2. Type into PTY: agentapi server --port {port} -- claude &
   3. Capture AgentAPI server PID
   4. Type into PTY: agentapi attach --url localhost:{port}
   5. Update process type: shell → claude
   6. Connect SSE client
   7. Send process_updated
   ```

4. **claude_kill handler**:
   ```
   1. Look up AgentAPI server PID
   2. Send SIGTERM via PTY: kill {pid}
   3. Wait for agentapi attach to exit
   4. Update process type: claude → shell
   5. Release port to pool
   6. Send process_updated
   ```

5. **Chat handlers**: subscribe, unsubscribe, send, raw, status, messages

### Key Rules
- `user` messages only when `status=stable`
- `raw` messages allowed anytime (for interrupts)
- All HTTP via SSH tunnel (never direct)

### Deliverables
- [ ] AgentAPI client working
- [ ] Shell ↔ Claude conversion
- [ ] SSE event forwarding
- [ ] Chat messaging

### Phase 4 Verification Checklist
**Docs to check**: ARCHITECTURE.md (AgentAPI Integration), BRIDGE-AGENTAPI.md (Full document), CHAT.md (AgentAPI Capabilities, Best Practices)
- [ ] All AgentAPI endpoints implemented: /status, /messages, /message, /upload, /events, /internal/screen
- [ ] HTTP client uses SSH tunnel transport (never direct)
- [ ] SSE events forwarded: message_update, status_change, screen_update
- [ ] claude_start follows exact steps from ARCHITECTURE.md Flow 3
- [ ] claude_kill follows exact steps from ARCHITECTURE.md Flow 8
- [ ] user messages rejected when agent status is running
- [ ] raw messages always accepted (for interrupts)

---

## Phase 5: Mobile App Foundation

### Objective
Set up React Native app with navigation and state management.

### Tasks

1. **Expo routing setup**
   ```
   app/
   ├── _layout.tsx           # Root layout
   └── (tabs)/
       ├── _layout.tsx       # Tab layout
       ├── index.tsx         # Hosts tab
       ├── chat.tsx          # Chat tab
       ├── terminal.tsx      # Terminal tab
       └── settings.tsx      # Settings tab
   ```

2. **Responsive layout hook**
   ```typescript
   const BREAKPOINTS = {
     phone: 0,       // Bottom tabs
     tablet: 768,    // Sidebar (collapsible)
     desktop: 1024,  // + Context panel
     wide: 1440,     // + Split views
   };
   ```

3. **Zustand stores**
   - connectionStore: Bridge WebSocket state
   - hostStore: SSH host configurations
   - processStore: Process registry
   - terminalStore: PTY buffers per process
   - chatStore: Messages, streaming state
   - settingsStore: Bridge URL, theme
   - layoutStore: Sidebar collapse

4. **BridgeProvider**
   - WebSocket connection management
   - Auto-reconnect with exponential backoff
   - Message routing to handlers
   - **Extensive debug logging**

5. **Theme support** (dark/light/system)

### Deliverables
- [ ] Expo app with tab navigation
- [ ] Responsive layout (phone/tablet/desktop)
- [ ] All Zustand stores
- [ ] BridgeProvider with reconnection

### Phase 5 Verification Checklist
**Docs to check**: APP.md (Platform Support, Responsive Layout System, Tab Structure, State Management)
- [ ] Four tabs: Hosts, Chat, Terminal, Settings (matching APP.md)
- [ ] Breakpoints: phone (0-767), tablet (768-1023), desktop (1024-1439), wide (1440+)
- [ ] All 7 Zustand stores created
- [ ] BridgeProvider has extensive debug logging
- [ ] Auto-reconnect with exponential backoff (1s-30s)

---

## Phase 6: Settings Tab

### Objective
Implement app configuration UI.

### Structure
```
Settings
├── Bridge Connection
│   └── URL: ws://192.168.1.100:8080/ws
├── SSH Hosts
│   ├── [+] Add Host
│   └── Host list with edit/delete
├── Appearance
│   ├── Theme: Dark/Light/System
│   └── Font Size
└── About
```

### Tasks
1. Settings main screen
2. Bridge URL configuration
3. SSH Host management (add/edit/delete)
4. Secure storage for credentials
5. Theme and font settings
6. Connection testing UI

### Deliverables
- [ ] Complete Settings tab
- [ ] Host configuration with secure storage
- [ ] Theme settings

### Phase 6 Verification Checklist
**Docs to check**: APP.md (Settings Tab), ARCHITECTURE.md (App Configuration, Settings Tab Structure)
- [ ] Settings structure matches ARCHITECTURE.md diagram
- [ ] BridgeConfig and SSHHostConfig interfaces implemented
- [ ] Secure storage used for SSH credentials
- [ ] Theme selection: dark/light/system

---

## Phase 7: Hosts Tab

### Objective
Implement host and process management UI.

### Components
- HostCard: Connection status, process count
- ProcessCard: Type, status, actions
- ProcessStatusBadge: Running/stable indicator

### Actions by Process Type

| Process Type | Actions |
|--------------|---------|
| Shell | Terminal, **Claude** (convert), Kill |
| Claude | Chat, Terminal, **Kill Claude** (revert), Kill |
| Stale | Kill only |

### Deliverables
- [ ] Host list with connection management
- [ ] Process list with all actions
- [ ] Stale process handling

### Phase 7 Verification Checklist
**Docs to check**: APP.md (Hosts Tab, Process Card), ARCHITECTURE.md (User Flows)
- [ ] Host card states: Disconnected, Connecting, Connected, Error
- [ ] ProcessInfo includes shellPid and agentApiPid fields
- [ ] Shell actions: Terminal, Claude (convert), Kill
- [ ] Claude actions: Chat, Terminal, Kill Claude (revert), Kill
- [ ] Stale process display with kill option
- [ ] All user flows 1-8 from ARCHITECTURE.md are supported

---

## Phase 8: Terminal Tab - Web

### Objective
Implement terminal with xterm.js for web platform.

### Tasks
1. xterm.js setup with FitAddon, WebLinksAddon
2. Theme configuration (dark/light)
3. PTY I/O connection
4. Process history management
5. History replay on process switch
6. Quick Actions bar (↑ ↓ Esc Ctrl+C)
7. Process selector header

### Deliverables
- [ ] Working web terminal
- [ ] Process switching with history
- [ ] Input bar and quick actions

### Phase 8 Verification Checklist
**Docs to check**: APP.md (Terminal Tab, Platform-Specific Implementation), CHAT.md (Control Mode for key sequences)
- [ ] xterm.js with FitAddon and WebLinksAddon
- [ ] 10,000 line scrollback
- [ ] Dark and light theme support
- [ ] Quick Actions: up arrow, down arrow, Esc, Ctrl+C
- [ ] Process history preserved per process (1MB max)
- [ ] History replay on process switch

---

## Phase 9: Terminal Tab - Native

### Objective
Implement terminal with custom FlatList renderer for iOS/Android.

### Tasks
1. AnsiStyleHelper for escape codes
2. TerminalLine component with memoization
3. FlatList-based renderer
4. 16, 256, 24-bit color support
5. Dimension calculation
6. Auto-scroll behavior
7. Native keyboard handling
8. iOS/Android testing

### Deliverables
- [ ] Working native terminal
- [ ] Full ANSI color support
- [ ] Performance optimized

### Phase 9 Verification Checklist
**Docs to check**: APP.md (Terminal Tab - Native Platform, ANSI Rendering)
- [ ] AnsiStyleHelper parses 16, 256, and 24-bit (truecolor) sequences
- [ ] TerminalLine component uses React.memo for performance
- [ ] FlatList-based rendering with virtualization
- [ ] getItemLayout implemented for consistent row heights
- [ ] Auto-scroll to bottom behavior matches web version
- [ ] Quick Actions bar works on native (↑ ↓ Esc Ctrl+C)
- [ ] Native keyboard handling for special keys
- [ ] iOS and Android tested and working

---

## Phase 10: Chat Tab

### Objective
Implement chat interface with AgentAPI integration.

### Components
```
┌─────────────────────────────────────────────────────────────────┐
│  Status Bar: [Claude Code]  Status: ● Running                   │
├─────────────────────────────────────────────────────────────────┤
│  Message List (virtualized, auto-scroll)                        │
│  - MessageBubble (user/agent)                                   │
│  - Streaming indicator                                          │
│  - "View Raw Screen" button                                     │
├─────────────────────────────────────────────────────────────────┤
│  Quick Actions: [↑] [↓] [Esc] [Ctrl+C] [y] [n]                  │
├─────────────────────────────────────────────────────────────────┤
│  Input: [Text input...] [📎] [Send]                              │
│  Mode: [Text] [Control]                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Empty States
- **No process selected**: "Select a process from the list"
- **Shell selected**: "This is a shell session. Start Claude to enable chat."

### Deliverables
- [ ] Complete Chat tab
- [ ] Real-time streaming
- [ ] File upload
- [ ] Raw screen modal

### Phase 10 Verification Checklist
**Docs to check**: APP.md (Chat Tab), CHAT.md (Full document), BRIDGE-AGENTAPI.md (Chat message types)
- [ ] Chat layout matches wireframe in CHAT.md
- [ ] Status bar shows: Claude Code, Running/Stable indicator
- [ ] MessageBubble distinguishes user vs agent
- [ ] Streaming indicator shows while agent is running
- [ ] "View Raw Screen" button opens modal with terminal view
- [ ] Quick Actions: ↑ ↓ Esc Ctrl+C y n (all from CHAT.md)
- [ ] Text Mode and Control Mode toggle
- [ ] File upload (📎 button) with 10MB limit
- [ ] Input disabled when agent status is "running" (per BRIDGE-AGENTAPI.md key rules)
- [ ] Raw keystrokes work anytime for interrupts
- [ ] Empty states: "Select a process" / "This is a shell session"
- [ ] SSE events (message_update, status_change) handled correctly
- [ ] Auto-scroll with manual scroll lock behavior

---

## Phase 11: Integration & Polish

### Objective
End-to-end integration and UI polish.

### Tasks
1. Full flow testing: Bridge → Host → Shell → Claude → Chat
2. Reconnection scenarios
3. Process switching between tabs
4. Error boundaries
5. Loading states
6. Toast notifications
7. Sidebar animations
8. Performance profiling
9. Memory leak testing
10. Cross-platform testing

### Deliverables
- [ ] Fully integrated system
- [ ] Polished UI with animations
- [ ] All platforms tested

### Phase 11 Verification Checklist
**Docs to check**: All documents (ARCHITECTURE.md, APP.md, CHAT.md, BRIDGE-AGENTAPI.md)
- [ ] Full flow works: Bridge → Host → Shell → Claude → Chat
- [ ] Reconnection: app reconnects automatically after Bridge restart
- [ ] Process discovery: existing processes found on reconnect
- [ ] Tab switching: correct process stays selected across tabs
- [ ] Terminal tab reflects Claude TUI when Claude process selected
- [ ] Chat tab disables for shell processes
- [ ] Error boundaries catch and display errors gracefully
- [ ] Loading states shown during async operations
- [ ] Toast notifications for success/error feedback
- [ ] Sidebar animations smooth on tablet/desktop
- [ ] No memory leaks (profile with React DevTools)
- [ ] Web, iOS, and Android all working

---

## Phase 12: Testing & Documentation

### Objective
Comprehensive testing and documentation.

### Test Types
1. **Unit tests**: Stores, protocol, ANSI parsing
2. **Integration tests**: Bridge flow, terminal I/O, process lifecycle
3. **E2E tests**: Full user flows (Playwright)

### Documentation
- README with setup instructions
- Deployment procedures
- Troubleshooting guide

### Deliverables
- [ ] Comprehensive test coverage
- [ ] Complete documentation
- [ ] CI/CD pipeline

### Phase 12 Verification Checklist
**Docs to check**: CLAUDE.md (Protocol Alignment Tests)
- [ ] Protocol alignment tests pass in BOTH TypeScript and Go (per CLAUDE.md requirement)
- [ ] Unit tests for: Zustand stores, protocol parsing, ANSI helper
- [ ] Integration tests for: Bridge message flow, terminal I/O, process lifecycle
- [ ] E2E tests cover all 8 user flows from ARCHITECTURE.md
- [ ] README includes setup instructions for dev environment
- [ ] Troubleshooting guide covers common issues
- [ ] CI runs all tests on push

---

## Phase 13: Local Testing

### Objective
Verify the complete system works locally before deployment.

### Test Environment

| Component | Location | Details |
|-----------|----------|---------|
| Bridge Service | Mac (local) | `localhost:8080` |
| Mobile App | Mac (web/simulator) | Expo dev server |
| Remote Host | Linux VM (Parallels) | `parallels@10.211.55.3` |

### SSH Configuration

```bash
# SSH connection details (private key already installed)
Host: 10.211.55.3
Port: 22
Username: parallels
Password: roee1236
```

### Prerequisites on Linux VM

```bash
# Install Claude Code
npm install -g @anthropic/claude-code

# Install AgentAPI
go install github.com/coder/agentapi@latest

# Verify installations
claude --version
agentapi --version

# Set up Anthropic API key
export ANTHROPIC_API_KEY="your-key-here"
```

### Step-by-Step Testing

#### 1. Start Bridge Service

```bash
cd services/bridge
LOG_LEVEL=debug go run cmd/bridge/main.go
```

Expected output:
```
[INFO] Bridge server starting on :8080
[DEBUG] WebSocket endpoint: /ws
```

#### 2. Start Mobile App (Web)

```bash
cd apps/mobile
npm run web
```

Open http://localhost:19006 in browser

#### 3. Configure Bridge Connection

1. Go to Settings tab
2. Enter Bridge URL: `ws://localhost:8080/ws`
3. Save and verify connection status shows "Connected"

#### 4. Add SSH Host

1. Go to Settings → SSH Hosts → Add Host
2. Configure:
   - Name: `Linux VM`
   - Host: `10.211.55.3`
   - Port: `22`
   - Username: `parallels`
   - Auth Type: Private Key (or Password: `roee1236`)
3. Save and Connect

#### 5. Test Shell Process

1. Go to Hosts tab
2. Click "New Shell" on Linux VM
3. Go to Terminal tab
4. Verify shell prompt appears
5. Type `ls -la` and verify output
6. Type `pwd` and verify working directory

#### 6. Test Claude Conversion

1. In Hosts tab, click "Claude" button on shell process
2. Watch terminal for AgentAPI startup
3. Verify process card shows "Claude" type
4. Verify Chat tab becomes active

#### 7. Test Chat Interface

1. Go to Chat tab
2. Verify status shows "stable"
3. Type a message: "Hello, what can you help me with?"
4. Verify message appears and Claude responds
5. Verify streaming indicator works
6. Test Quick Actions (Ctrl+C should work even when running)

#### 8. Test Terminal While Claude Running

1. Go to Terminal tab (with Claude process selected)
2. Verify you see Claude Code TUI
3. Type in terminal and verify it works
4. Observe that terminal and chat show same session

#### 9. Test Kill Claude (Revert to Shell)

1. Go to Hosts tab
2. Click "Kill Claude" on the Claude process
3. Verify process reverts to "Shell" type
4. Go to Terminal tab, verify shell prompt is back
5. Go to Chat tab, verify empty state shows

#### 10. Test Reconnection

1. Stop the Bridge service (Ctrl+C)
2. Verify app shows "Disconnected" state
3. Restart Bridge: `go run cmd/bridge/main.go`
4. Verify app reconnects automatically
5. Verify existing processes are rediscovered

#### 11. Test Process Switching

1. Create multiple shell processes
2. Convert some to Claude
3. Switch between processes in Terminal tab
4. Verify history is preserved for each
5. Switch in Chat tab, verify correct messages show

### Debug Logging Verification

#### Bridge Logs Should Show:
```
[DEBUG] [WS] New connection from 127.0.0.1:xxxxx
[DEBUG] [WS] Received: type=auth payload={}
[DEBUG] [WS] Sending: type=auth_result payload={success:true, sessionId:abc123}
[DEBUG] [WS] Received: type=host_connect payload={host:10.211.55.3, port:22, ...}
[DEBUG] [SSH] Connecting to parallels@10.211.55.3:22
[DEBUG] [SSH] Connection established
[DEBUG] [SSH] Scanning ports 3284-3299 for existing AgentAPI servers
[DEBUG] [WS] Sending: type=host_status payload={connected:true, processes:[]}
[DEBUG] [WS] Received: type=process_create payload={}
[DEBUG] [PTY] Creating new PTY session
[DEBUG] [PTY] PTY created, shell started
[DEBUG] [WS] Sending: type=process_created payload={id:xxx, type:shell}
[DEBUG] [WS] Received: type=pty_input payload={processId:xxx, data:ls -la\r}
[DEBUG] [PTY] Writing to PTY: "ls -la\r"
[DEBUG] [PTY] PTY output: "drwxr-xr-x..."
[DEBUG] [WS] Sending: type=pty_output payload={processId:xxx, data:...}
```

#### App Console Logs Should Show:
```
[WS] Connecting to ws://localhost:8080/ws
[WS] Connected
[WS] Sending: auth {}
[WS] Received: auth_result {success: true, sessionId: "abc123"}
[WS] Sending: host_connect {host: "10.211.55.3", port: 22, ...}
[WS] Received: host_status {connected: true, processes: []}
[WS] Sending: process_create {}
[WS] Received: process_created {id: "xxx", type: "shell"}
[WS] Sending: pty_input {processId: "xxx", data: "ls -la\r"}
[WS] Received: pty_output {processId: "xxx", data: "..."}
```

### Test Checklist

| Test | Status |
|------|--------|
| Bridge starts and accepts WebSocket connections | ☐ |
| App connects to Bridge successfully | ☐ |
| SSH host can be added and connected | ☐ |
| New shell process can be created | ☐ |
| Terminal shows shell output correctly | ☐ |
| Terminal input works (commands execute) | ☐ |
| Shell can be converted to Claude | ☐ |
| Chat interface shows messages | ☐ |
| Chat input sends messages to Claude | ☐ |
| Streaming responses display correctly | ☐ |
| Quick actions (Ctrl+C, etc.) work | ☐ |
| Kill Claude reverts to shell | ☐ |
| App reconnects after Bridge restart | ☐ |
| Existing processes rediscovered on reconnect | ☐ |
| Process switching preserves terminal history | ☐ |
| Multiple Claude processes work simultaneously | ☐ |
| Stale processes can be killed | ☐ |
| All debug logs appear correctly | ☐ |

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| SSH connection refused | Verify VM is running and SSH service is active |
| AgentAPI not found | Install agentapi on the VM: `go install github.com/coder/agentapi@latest` |
| Claude not responding | Check ANTHROPIC_API_KEY is set on VM |
| Port already in use | Kill stale AgentAPI servers: `pkill -f agentapi` |
| WebSocket disconnect | Check Bridge is running, verify URL in Settings |

### Phase 13 Verification Checklist
**This is the FINAL comprehensive audit. Check ALL design documents.**

#### ARCHITECTURE.md Audit
- [ ] **System Overview**: Two-layer architecture implemented (App↔Bridge, Bridge↔SSH)
- [ ] **Process Types**: Shell and Claude types work correctly
- [ ] **Connection Architecture**: Multiple hosts, multiple processes per host supported
- [ ] **All 8 User Flows verified**:
  - [ ] Flow 1: App startup & connection to Bridge
  - [ ] Flow 2: SSH host connection
  - [ ] Flow 3: New Shell process creation
  - [ ] Flow 4: Convert Shell to Claude
  - [ ] Flow 5: Chat interaction
  - [ ] Flow 6: Terminal interaction
  - [ ] Flow 7: Process switching
  - [ ] Flow 8: Kill Claude (revert to Shell)
- [ ] **WebSocket Protocol**: All 20+ message types implemented and working
- [ ] **Key Payloads**: All payload structures match exactly
- [ ] **AgentAPI Integration**: Port range 3284-3299, SSH tunnel used
- [ ] **Bridge State Management**: ProcessRegistry, PortPool, SSE handlers correct

#### APP.md Audit
- [ ] **Platform Support**: Web, iOS, Android all working
- [ ] **Responsive Layout**: All breakpoints (phone/tablet/desktop/wide) implemented
- [ ] **Tab Structure**: Hosts, Chat, Terminal, Settings tabs complete
- [ ] **State Management**: All 7 Zustand stores functional
- [ ] **Settings Tab**: Bridge config, SSH hosts, theme, all working
- [ ] **Hosts Tab**: Host cards, process cards, all actions available
- [ ] **Terminal Tab**: Web (xterm.js) and Native (FlatList) implementations
- [ ] **Chat Tab**: All components per wireframe
- [ ] **File Structure**: Matches the documented structure

#### CHAT.md Audit
- [ ] **AgentAPI Capabilities**: All endpoints used correctly
- [ ] **Chat Interface**: Matches wireframe layout
- [ ] **Quick Actions**: All buttons (↑ ↓ Esc Ctrl+C y n) working
- [ ] **Text Mode / Control Mode**: Toggle works
- [ ] **Streaming Behavior**: Live updates, auto-scroll, manual scroll lock
- [ ] **Raw Screen View**: Modal with terminal display
- [ ] **File Upload**: Working with 10MB limit
- [ ] **Status Indicators**: Running/Stable displayed correctly

#### BRIDGE-AGENTAPI.md Audit
- [ ] **Message Types Table**: All types implemented
- [ ] **Payload Definitions**: All interfaces match
- [ ] **Message Flow Diagrams**: All 6 flows verified:
  - [ ] 1. Subscribing to Chat Events
  - [ ] 2. Sending a User Message
  - [ ] 3. Sending Raw Keystrokes (Interrupt)
  - [ ] 4. Getting Message History
  - [ ] 5. Uploading a File
  - [ ] 6. Viewing Raw Screen
- [ ] **SSE Connection Management**: Per-host connections working
- [ ] **HTTP via SSH Tunnel**: Verified no direct connections
- [ ] **Key Rules Enforced**:
  - [ ] user messages only when stable
  - [ ] raw messages anytime
  - [ ] Base64 for file uploads

#### Protocol Alignment
- [ ] TypeScript alignment tests pass
- [ ] Go alignment tests pass
- [ ] Both test suites have NO skips

#### Debug Logging
- [ ] Bridge logs all WebSocket messages (received and sent)
- [ ] Bridge logs all SSH operations
- [ ] Bridge logs all AgentAPI HTTP calls
- [ ] App logs all WebSocket messages (received and sent)
- [ ] Log levels configurable (DEBUG/INFO/WARN/ERROR)

#### Local Test Environment
- [ ] Bridge runs on Mac localhost:8080
- [ ] App connects to Bridge successfully
- [ ] SSH to Linux VM (10.211.55.3) works
- [ ] All test checklist items above completed

---

## Critical Requirements Summary

1. **Protocol Alignment**: TS and Go types MUST match exactly (verified by tests)
2. **SSH Tunnel**: ALL AgentAPI HTTP calls go through SSH tunnel (no direct HTTP)
3. **User Messages**: Only allowed when agent status is `stable`
4. **Raw Messages**: Always allowed (for interrupts like Ctrl+C)
5. **Debug Logging**: Extensive logging in both Bridge and App for troubleshooting
6. **Process Conversion**: Shell ↔ Claude conversion is bidirectional

---

## File Structure

```
remote-claude-v2/
├── apps/
│   └── mobile/                    # Expo React Native app
│       ├── app/
│       │   ├── _layout.tsx
│       │   └── (tabs)/
│       │       ├── _layout.tsx
│       │       ├── index.tsx      # Hosts
│       │       ├── chat.tsx       # Chat
│       │       ├── terminal.tsx   # Terminal
│       │       └── settings.tsx   # Settings
│       ├── components/
│       │   ├── layout/
│       │   ├── hosts/
│       │   ├── process/
│       │   ├── terminal/
│       │   └── chat/
│       ├── hooks/
│       ├── stores/
│       ├── lib/
│       └── providers/
├── services/
│   └── bridge/                    # Go Bridge service
│       ├── cmd/bridge/main.go
│       ├── internal/
│       │   ├── server/
│       │   ├── ssh/
│       │   ├── agentapi/
│       │   ├── process/
│       │   └── protocol/
│       └── go.mod
├── packages/
│   └── shared-types/              # Protocol TypeScript types
│       ├── src/
│       └── package.json
├── pnpm-workspace.yaml
├── package.json
├── CLAUDE.md
├── ARCHITECTURE.md
├── BRIDGE-AGENTAPI.md
├── CHAT.md
├── APP.md
└── implementation-plan.md         # This file
```
