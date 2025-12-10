# APP.md - Remote Claude Mobile App Design

This document defines the complete app architecture for the Remote Claude mobile application. The app supports **Expo React Native** (iOS/Android) and **Expo Web** with responsive layouts.

**Related Documentation:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture and flows (source of truth)
- [CHAT.md](./CHAT.md) - Chat Tab UI and AgentAPI interaction
- [BRIDGE-AGENTAPI.md](./BRIDGE-AGENTAPI.md) - Bridge-AgentAPI WebSocket protocol

---

## Connection Architecture

The app has **TWO separate connection layers**:

```
┌──────────────┐   WebSocket    ┌──────────────┐     SSH      ┌──────────────┐
│  Mobile App  │ ─────────────> │    Bridge    │ ───────────> │  SSH Host A  │
│              │   (Layer 1)    │   Service    │   (Layer 2)  └──────────────┘
│              │                │              │       │
│              │                │              │       │       ┌──────────────┐
│              │                │              │       └─────> │  SSH Host B  │
└──────────────┘                └──────────────┘               └──────────────┘
```

### Layer 1: App ↔ Bridge (WebSocket)
- Configured **once** in Settings Tab
- Bridge URL format: `ws://{bridge-host}:{port}/ws`
- Bridge can run anywhere accessible to the mobile app

### Layer 2: Bridge ↔ SSH Hosts
- **Multiple SSH hosts** can be configured
- Each host configured with: hostname, port (22), username, password/key
- Each SSH host can run Claude Code processes

---

## Process Types

### Shell Process (PTY Only)
- Pure terminal session via SSH
- No AgentAPI integration
- Used for general shell commands
- **Can be converted to Claude process**

### Claude Process (PTY + AgentAPI)
- Started via `agentapi server --port {port} -- claude`
- PTY shows Claude Code TUI (via `agentapi attach`)
- AgentAPI provides programmatic chat access
- **Terminal Tab and Chat Tab share the SAME session**

### Process Conversion Flow

```
┌─────────────────┐                    ┌─────────────────┐
│  Shell Process  │  ─ "Claude" btn ─> │ Claude Process  │
│                 │                    │                 │
│  PTY: bash      │                    │  PTY: agentapi  │
│  AgentAPI: none │ <─ "Kill Claude" ─ │       attach    │
│                 │                    │  AgentAPI: :3284│
└─────────────────┘                    └─────────────────┘
     (Terminal only)                   (Terminal + Chat)
```

**IMPORTANT**: There is NO way to create a Claude process directly. User must:
1. Create a shell process first
2. Convert it to Claude using the "Claude" button

---

## Platform Support

| Platform | Terminal Implementation | Navigation |
|----------|------------------------|------------|
| **iOS** | Custom FlatList-based renderer | Bottom tabs (phone) / Sidebar (tablet) |
| **Android** | Custom FlatList-based renderer | Bottom tabs (phone) / Sidebar (tablet) |
| **Web** | xterm.js | Sidebar (always) |

---

## Responsive Layout System

### Breakpoints

```typescript
const BREAKPOINTS = {
  phone: 0,       // 0-767px: Single column, bottom tab navigation
  tablet: 768,    // 768-1023px: Two-pane, collapsible sidebar
  desktop: 1024,  // 1024-1439px: Three-pane with context panel
  wide: 1440,     // 1440px+: Full layout with split views
};
```

### Layout Behavior Matrix

| Screen Size | Width | Bottom Tabs | Sidebar | Context Panel | Split Main |
|-------------|-------|-------------|---------|---------------|------------|
| Phone | 0-767px | ✓ | ✗ | ✗ | ✗ |
| Tablet | 768-1023px | ✗ | ✓ (240px, collapsible) | ✗ | ✗ |
| Desktop | 1024-1439px | ✗ | ✓ (240px, collapsible) | ✓ (300px) | ✗ |
| Wide | 1440px+ | ✗ | ✓ (200px, collapsible) | ✓ (320px) | ✓ |

### useResponsiveLayout Hook

```typescript
interface LayoutConfig {
  screenSize: 'phone' | 'tablet' | 'desktop' | 'wide';
  showBottomTabs: boolean;     // true only on phone
  showSidebar: boolean;        // false only on phone
  showContextPanel: boolean;   // only desktop/wide
  showSplitMain: boolean;      // only wide
  sidebarWidth: number;        // 200-240px based on screen
  contextPanelWidth: number;   // 300-320px based on screen
}

function useResponsiveLayout(): LayoutConfig {
  const { width } = useWindowDimensions();

  if (width < BREAKPOINTS.tablet) {
    return { screenSize: 'phone', showBottomTabs: true, showSidebar: false, ... };
  }
  if (width < BREAKPOINTS.desktop) {
    return { screenSize: 'tablet', showBottomTabs: false, showSidebar: true, ... };
  }
  // ...
}
```

---

## Tab Structure

### Four Main Tabs

```
┌─────────────────────────────────────────────────────────────────┐
│                          App Layout                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [Hosts]  [Chat]  [Terminal]  [Settings]                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| Tab | Route | Icon | Description |
|-----|-------|------|-------------|
| Hosts | `/` (index) | `server-outline` | Host management, connection status |
| Chat | `/chat` | `chatbubble-outline` | Claude Code chat interface (see CHAT.md) |
| Terminal | `/terminal` | `terminal-outline` | Direct PTY terminal access |
| Settings | `/settings` | `settings-outline` | App configuration |

### Navigation Architecture

```typescript
type TabId = 'hosts' | 'chat' | 'terminal' | 'settings';

// Route to tab mapping
function routeToTabId(pathname: string): TabId {
  if (pathname.includes('/chat')) return 'chat';
  if (pathname.includes('/terminal')) return 'terminal';
  if (pathname.includes('/settings')) return 'settings';
  return 'hosts';
}
```

---

## Navigation Components

### Bottom Tab Bar (Phone Only)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                        [Content Area]                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│   🏠         💬         💻         ⚙️                            │
│  Hosts     Chat     Terminal   Settings                          │
└─────────────────────────────────────────────────────────────────┘
```

- Safe area padding for notch devices
- Active tab: filled icon + accent color (#007AFF)
- Inactive tab: outline icon + gray (#8E8E93)

### Sidebar (Tablet/Desktop/Wide)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │                                                       │
│  [Logo]  │                                                       │
│          │                                                       │
│  ○ Hosts │                    Content Area                       │
│  ○ Chat  │                                                       │
│  ● Term  │                                                       │
│  ○ Sett  │                                                       │
│          │                                                       │
│          │                                                       │
│  [◀]     │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

**Sidebar Features:**
- Collapsible: 64px (icon only) ↔ 240px (with labels)
- Collapse toggle button at bottom
- Smooth animation via `LayoutAnimation`
- Persisted collapse state in store

---

## Hosts Tab (Process Management)

### Overview

The Hosts tab manages SSH connections and processes running on remote hosts.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Hosts                            [+ Add] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🟢 dev-server                                              │ │
│  │    user@192.168.1.100:22                                   │ │
│  │    3 processes                                  [Connect ▼]│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ⚪ production                                               │ │
│  │    deploy@prod.example.com:22                              │ │
│  │    Not connected                               [Connect ▼] │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Host Card

```typescript
interface Host {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  // Auth (one of):
  password?: string;
  privateKey?: string;
  // Status
  connected: boolean;
}
```

**Host Card States:**
- **Disconnected**: Gray dot, "Connect" button
- **Connecting**: Pulsing yellow dot, "Connecting..." text
- **Connected**: Green dot, process count, dropdown menu
- **Error**: Red dot, error message, "Retry" button

### Add/Edit Host Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  Add New Host                                           [Close] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Name:          [________________________]                       │
│  Host:          [________________________]                       │
│  Port:          [22______________________]                       │
│  Username:      [________________________]                       │
│                                                                  │
│  Authentication:                                                 │
│  ○ Password     ○ Private Key                                   │
│                                                                  │
│  Password:      [________________________]                       │
│                                                                  │
│                              [Cancel]  [Save & Connect]          │
└─────────────────────────────────────────────────────────────────┘
```

### Process List (Per Host)

When a host is expanded or selected, show its processes:

```
┌─────────────────────────────────────────────────────────────────┐
│  dev-server Processes                            [+ New Shell]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ● claude-1 (Claude)                               [Active] │ │
│  │   Port 3284 • Running • 2h 15m                             │ │
│  │   Working on: "Add dark mode toggle..."                    │ │
│  │                      [Chat] [Terminal] [Kill Claude] [Kill]│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ○ shell-2 (Shell)                                          │ │
│  │   bash • Idle • 45m                                        │ │
│  │                              [Terminal] [Claude] [Kill]    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ⚠️ Stale Process                                            │ │
│  │   Port 3285 • Connection refused                           │ │
│  │                                                    [Kill]  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Process Card

```typescript
interface ProcessInfo {
  id: string;
  hostId: string;
  type: 'shell' | 'claude';      // Only two types
  shellPid: number;               // PID of the shell/PTY process itself
  agentApiPid?: number;           // PID of AgentAPI server (only for Claude processes)
  port?: number;                  // 3284-3299 for Claude, undefined for shell
  cwd: string;                    // Working directory
  ptyReady: boolean;
  agentApiReady: boolean;         // true only for Claude processes
  startedAt: Date;
}
```

**PID Fields Explained:**
- `shellPid`: The PID of the shell process (bash/zsh) that owns the PTY. Always present.
- `agentApiPid`: The PID of the `agentapi server` process. Only present for Claude processes. Required to properly kill the AgentAPI server when converting Claude → Shell (Flow 8).

**Example State Transitions:**
```
Shell Process:     { shellPid: 1234, agentApiPid: undefined, port: undefined }
       ↓ Claude button
Claude Process:    { shellPid: 1234, agentApiPid: 5678, port: 3284 }
       ↓ Kill Claude button
Shell Process:     { shellPid: 1234, agentApiPid: undefined, port: undefined }
```

**Process Actions by Type:**

| Process Type | Available Actions |
|--------------|-------------------|
| **Shell** | Terminal, **Claude** (convert), Kill |
| **Claude** | Chat, Terminal, **Kill Claude** (revert to shell), Kill |
| **Stale** | Kill only |

**Key Actions:**
- **Claude** button: Convert shell → Claude (starts AgentAPI)
- **Kill Claude** button: Convert Claude → shell (stops AgentAPI, keeps PTY)
- **Kill** button: Terminate entire process (closes PTY)

### Stale Process Handling

On reconnection, Bridge scans ports 3284-3299 for existing AgentAPI servers. If found but not connectable:

```typescript
interface StaleProcess {
  port: number;
  reason: 'connection_refused' | 'timeout' | 'unknown';
}
```

User should be prompted to kill stale processes to free up ports.

---

## User Flows

All flows match [ARCHITECTURE.md](./ARCHITECTURE.md) - the source of truth.

### Flow 0: Configure Bridge (One-time Setup)
1. User opens Settings Tab
2. User enters Bridge URL: `ws://{bridge-host}:{port}/ws`
3. App saves Bridge URL
4. App connects to Bridge via WebSocket
5. Bridge → App: `auth_result(success, session_id)`

### Flow 1: Add SSH Host
1. User opens Hosts Tab → "Add Host"
2. User enters: Name, SSH Host, Port, Username, Auth
3. App saves host configuration locally
4. App → Bridge: `host_connect(host, port, username, credentials)`
5. Bridge establishes SSH connection
6. Bridge scans ports 3284-3299 for existing AgentAPI servers
7. Bridge → App: `host_status(host_id, connected, existing_processes[], stale_processes[])`
8. App displays process list for this host

### Flow 2: Start New Shell
1. User taps "New Shell" button
2. App → Bridge: `process_create(type: "shell")`
3. Bridge creates new PTY session
4. Bridge → App: `process_created(id, type: "shell", pty_ready: true)`
5. User can now use Terminal Tab

### Flow 3: Convert Shell → Claude
1. User has an existing shell process selected
2. User taps "Claude" button on that shell
3. App → Bridge: `claude_start(process_id)`
4. Bridge:
   - Allocates port from pool (3284-3299)
   - Types into PTY: `agentapi server --port {port} -- claude &`
   - Captures PID of agentapi server
   - Types into PTY: `agentapi attach --url localhost:{port}`
   - Updates process type: "shell" → "claude"
   - Connects AgentAPI client via SSH tunnel
5. Bridge → App: `process_updated(id, type: "claude", port, agentapi_ready: true)`
6. User can now use both Terminal Tab AND Chat Tab

### Flow 4: Using Terminal Tab
1. User types in terminal
2. App → Bridge: `pty_input(process_id, data)`
3. Bridge writes to PTY stdin
4. PTY output → Bridge → App: `pty_output(process_id, data)`
5. App renders terminal output

### Flow 5: Using Chat Tab
1. User types message
2. App → Bridge: `chat_send(process_id, content, type: "user")`
3. Bridge → AgentAPI: `POST /message {role: "user", content: "..."}`
4. AgentAPI → Bridge (SSE): message_update events
5. Bridge → App: `chat_event(process_id, event)`
6. App updates chat UI

### Flow 6: Reconnection
1. App reconnects after disconnect
2. App → Bridge: `host_connect(...)`
3. Bridge scans ports 3284-3299
4. For each port with AgentAPI server:
   - Try `GET /status`
   - If success: add to existing_processes
   - If fail: mark as stale
5. Bridge → App: `host_status(connected, existing_processes[], stale_processes[])`
6. App prompts user about stale processes
7. User can kill stale processes via `process_kill`

### Flow 7: Switch Between Sessions
1. User has multiple processes
2. User taps on different process in list
3. App → Bridge: `process_select(process_id)`
4. App updates Terminal Tab (switches PTY)
5. App updates Chat Tab (switches AgentAPI connection, or shows empty state for shell)

### Flow 8: Kill Claude (Revert to Shell)
1. User taps "Kill Claude" on a Claude process
2. App → Bridge: `claude_kill(process_id)`
3. Bridge:
   - Looks up AgentAPI server PID
   - Sends SIGTERM: `kill {pid}`
   - Waits for agentapi attach to exit
   - Updates process type: "claude" → "shell"
   - Releases port back to pool
4. Bridge → App: `process_updated(id, type: "shell", port: null, agentapi_ready: false)`
5. PTY now shows shell prompt
6. User can use Terminal Tab as normal shell
7. **Chat Tab shows empty state** for this process

---

## Chat Tab

### Overview

The Chat Tab provides a programmatic chat interface to Claude Code via AgentAPI. See [CHAT.md](./CHAT.md) for full details.

### Chat Tab States

The Chat Tab content depends on the **selected process type**:

#### When Claude Process is Selected
Full chat interface with:
- Message history from AgentAPI
- Input bar for sending messages
- Quick action buttons: `[↑] [↓] [Esc] [Ctrl+C] [y] [n]`
- Streaming indicator when Claude is responding
- File upload capability

#### When Shell Process is Selected
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

Tapping "Start Claude Code" triggers Flow 3 (Shell → Claude conversion).

#### When No Process is Selected
```
┌─────────────────────────────────────┐
│                                     │
│      No process selected.           │
│      Select a process from the      │
│      list to get started.           │
│                                     │
└─────────────────────────────────────┘
```

---

## Terminal Tab

### Overview

Full terminal emulator for direct PTY access. Supports both **web (xterm.js)** and **native (custom renderer)**.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Process: claude-code-1 ▼                    [Split] [Maximize] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ╭─────────────────────────────────────────────────────────────╮│
│  │ $ claude                                                    ││
│  │                                                             ││
│  │ ╭───────────────────────────────────────────────────────────╮│
│  │ │ Claude Code                                               │││
│  │ ├───────────────────────────────────────────────────────────┤│
│  │ │                                                           │││
│  │ │ I'll help you implement dark mode.                        │││
│  │ │                                                           │││
│  │ │ > Reading src/theme.ts                                    │││
│  │ │                                                           │││
│  │ │ ───────────────────────────────────────────────────────── │││
│  │ │ ? Continue? (y/n) █                                       │││
│  │ ╰───────────────────────────────────────────────────────────╯│
│  ╰─────────────────────────────────────────────────────────────╯│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [↑] [↓] [Esc] [Ctrl+C]                                         │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐  [Send/↵]  │
│ │ Type command...                                 │             │
│ └─────────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Platform-Specific Implementation

#### Web Terminal (xterm.js)

File: `components/terminal/TerminalView.web.tsx`

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalViewHandle {
  write(data: string): void;
  clear(): void;
  focus(): void;
  blur(): void;
  getDimensions(): { rows: number; cols: number };
}

// Features:
// - 10,000 line scrollback
// - Blinking cursor
// - Web links clickable
// - 24-bit RGB color support
// - ResizeObserver for responsive sizing
// - Theme support (dark/light)
```

**xterm.js Theme:**
```typescript
const DARK_THEME: ITheme = {
  background: '#1E1E1E',
  foreground: '#D4D4D4',
  cursor: '#FFFFFF',
  cursorAccent: '#000000',
  selectionBackground: '#264F78',
  black: '#000000',
  red: '#CD3131',
  green: '#0DBC79',
  yellow: '#E5E510',
  blue: '#2472C8',
  magenta: '#BC3FBC',
  cyan: '#11A8CD',
  white: '#E5E5E5',
  // Bright variants...
};
```

#### Native Terminal (React Native)

File: `components/terminal/TerminalView.native.tsx`

```typescript
// Custom FlatList-based terminal renderer
// Features:
// - ANSI escape code parsing (AnsiStyleHelper.ts)
// - Line-based rendering with memoization
// - Max 10,000 lines (auto-trim)
// - Auto-scroll to end
// - Memory efficient

// Dimension calculation:
const charWidth = fontSize * 0.6;
const charHeight = fontSize * 1.2;
const cols = Math.floor(containerWidth / charWidth);
const rows = Math.floor(containerHeight / charHeight);
```

**ANSI Color Parsing:**
```typescript
// AnsiStyleHelper converts escape sequences to React Native TextStyle
// Supports: 16 colors, 256 colors, 24-bit RGB
// Example: \x1b[31m = { color: '#CD3131' }
```

### PTY History Management

Each process maintains its own terminal history:

```typescript
interface TerminalStore {
  // Per-process history storage
  processHistories: Map<string, ProcessHistory>;

  // Active process
  activeProcessId: string | null;

  // Raw output queue for xterm.js
  rawOutputQueue: string[];

  // Actions
  setActiveProcess(processId: string): void;
  getProcessHistory(processId: string): string | null;
  appendOutput(processId: string, data: string): void;
  clearProcessHistory(processId: string): void;
}

interface ProcessHistory {
  rawOutput: string;  // Preserves ANSI codes
  // Max size: 1MB per process
}
```

**History Switching Flow:**
1. User selects different process
2. Clear terminal display: `terminalRef.current?.clear()`
3. Get history: `getProcessHistory(newProcessId)`
4. Replay: `terminalRef.current?.write(history)`

### Terminal Input Bar

```
┌─────────────────────────────────────────────────────────────────┐
│  Quick Actions:  [↑] [↓] [Esc] [Ctrl+C]                         │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────┐  [Send/↵]         │
│ │ $ ls -la                                  │  [Raw Mode: Off]  │
│ └───────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

**Quick Action Buttons:**

| Button | Action | Raw Content | Description |
|--------|--------|-------------|-------------|
| **↑** | Up arrow | `\x1b[A` | Previous command in history |
| **↓** | Down arrow | `\x1b[B` | Next command in history |
| **Esc** | Escape key | `\x1b` | Cancel current input/operation |
| **Ctrl+C** | SIGINT | `\x03` | Interrupt running process |

These buttons are always visible and functional, providing quick access to common terminal operations without needing a physical keyboard.

**Additional Features:**
- Text input with command history
- Send button (or Enter key on keyboard)
- Raw mode toggle: send every keystroke immediately
- History navigation via escape sequences or buttons

**Key Event to Sequence Mapping:**
```typescript
function keyEventToSequence(key: string, ctrlKey: boolean): string {
  if (ctrlKey) {
    switch (key.toLowerCase()) {
      case 'c': return '\x03';  // SIGINT
      case 'd': return '\x04';  // EOF
      case 'l': return '\x0c';  // Clear
      case 'z': return '\x1a';  // SIGTSTP
      // ...
    }
  }
  switch (key) {
    case 'ArrowUp': return '\x1b[A';
    case 'ArrowDown': return '\x1b[B';
    case 'Tab': return '\t';
    case 'Enter': return '\r';
    case 'Escape': return '\x1b';
    // ...
  }
  return key;
}
```

### Process Selector Header

```
┌─────────────────────────────────────────────────────────────────┐
│  ● claude-code-1 ▼                           [+] [Split] [⛶]   │
├─────────────────────────────────────────────────────────────────┤
│  │                                                              │
│  ▼ Process Dropdown                                             │
│  ┌────────────────────────────────────────┐                     │
│  │ ● claude-code-1                        │                     │
│  │ ○ shell-2                              │                     │
│  │ ○ shell-3                              │                     │
│  │ ─────────────────────────              │                     │
│  │ + New Terminal                         │                     │
│  └────────────────────────────────────────┘                     │
```

---

## Settings Tab

### Overview

Configuration and management screen with multi-section navigation.

### Settings Structure (per ARCHITECTURE.md)

```
Settings
├── Bridge Connection
│   └── URL: ws://192.168.1.100:8080/ws  [Edit]
│
├── SSH Hosts
│   ├── [+] Add Host
│   ├── My Dev Server (192.168.1.100) [Edit] [Delete]
│   └── Production (prod.example.com) [Edit] [Delete]
│
├── Appearance
│   ├── Theme: Dark/Light/System
│   └── Font Size: 14pt
│
└── About
    └── Version, Links
```

### Main Settings Menu

```
┌─────────────────────────────────────────────────────────────────┐
│                         Settings                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BRIDGE CONNECTION (Layer 1)                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🌐 Bridge URL                                              │ │
│  │    ws://192.168.1.100:8080/ws                           >  │ │
│  │    Status: 🟢 Connected                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  SSH HOSTS (Layer 2)                                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🏠 Manage SSH Hosts                                        │ │
│  │    2 hosts configured                                   >  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  APPEARANCE                                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🎨 Theme                                                   │ │
│  │    Dark                                                 >  │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 🔤 Font Size                                               │ │
│  │    14pt                                                 >  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ABOUT                                                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ℹ️ About Remote Claude                                      │ │
│  │    Version 1.0.0                                        >  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Bridge Configuration (One-time Setup)

```
┌─────────────────────────────────────────────────────────────────┐
│  Bridge Connection                                      [Close] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  The Bridge service proxies connections between this app        │
│  and your SSH hosts. Configure the Bridge URL once.             │
│                                                                  │
│  Bridge URL:    [ws://192.168.1.100:8080/ws_______]             │
│                                                                  │
│  Status:        🟢 Connected (session: abc123)                  │
│                                                                  │
│                              [Cancel]  [Save & Connect]          │
└─────────────────────────────────────────────────────────────────┘
```

### Settings Item Component

```typescript
interface SettingsItemProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightContent?: React.ReactNode;
  disabled?: boolean;
  showChevron?: boolean;
}
```

### Theme Settings

```typescript
interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  terminalFontSize: number;  // 10-24
  chatFontSize: number;      // 12-20
  hapticFeedback: boolean;
  soundEffects: boolean;
}
```

---

## State Management (Zustand)

### Store Structure (per ARCHITECTURE.md)

```
stores/
├── connection.ts    # Bridge WebSocket connection state
├── hosts.ts         # SSH host configurations (multiple hosts)
├── process.ts       # Process registry, active process selection
├── terminal.ts      # PTY buffer, cursor state, per-process history
├── chat.ts          # Message history, streaming state
├── settings.ts      # App settings (bridge URL, appearance)
└── layout.ts        # Sidebar collapse state
```

### Process Store

```typescript
interface ProcessStore {
  processes: Map<string, ProcessInfo>;
  activeProcessId: string | null;
  staleProcesses: Map<number, StaleProcess>;  // port -> stale info

  // Actions
  addProcess(process: ProcessInfo): void;
  removeProcess(processId: string): void;
  updateProcess(processId: string, updates: Partial<ProcessInfo>): void;
  setActiveProcess(processId: string): void;
  getProcessesByHost(hostId: string): ProcessInfo[];

  // Stale process handling
  addStaleProcess(port: number, reason: string): void;
  removeStaleProcess(port: number): void;
}
```

### Host Store

```typescript
interface HostStore {
  hosts: Map<string, Host>;
  connectedHosts: Set<string>;

  // Actions
  addHost(host: Host): void;
  updateHost(hostId: string, updates: Partial<Host>): void;
  removeHost(hostId: string): void;
  setHostConnected(hostId: string, connected: boolean): void;
}
```

### Connection Store (Bridge)

```typescript
interface ConnectionStore {
  bridgeUrl: string | null;
  connected: boolean;
  reconnecting: boolean;
  sessionId: string | null;
  error: string | null;

  // Bridge WebSocket
  ws: WebSocket | null;

  // Actions
  setBridgeUrl(url: string): void;
  connect(): Promise<void>;
  disconnect(): void;
  send(message: BridgeMessage): void;
}
```

### Settings Store

```typescript
interface SettingsStore {
  // Bridge (Layer 1)
  bridgeUrl: string;

  // Appearance
  theme: 'light' | 'dark' | 'system';
  terminalFontSize: number;
  chatFontSize: number;

  // Actions
  setBridgeUrl(url: string): void;
  setTheme(theme: 'light' | 'dark' | 'system'): void;
  setTerminalFontSize(size: number): void;
}
```

---

## WebSocket Communication

### Message Types (per ARCHITECTURE.md)

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | App → Bridge | Authenticate session |
| `auth_result` | Bridge → App | Auth response |
| `host_connect` | App → Bridge | Connect to remote SSH host |
| `host_disconnect` | App → Bridge | Disconnect from host |
| `host_status` | Bridge → App | Connection status update |
| `process_list` | App → Bridge | Request process list |
| `process_list_result` | Bridge → App | List of all processes |
| `process_create` | App → Bridge | Create new shell process |
| `process_created` | Bridge → App | Process created |
| `process_select` | App → Bridge | Switch active process |
| `process_kill` | App → Bridge | Kill a process (closes PTY entirely) |
| `process_updated` | Bridge → App | Process state changed |
| `claude_start` | App → Bridge | Convert shell to Claude process |
| `claude_kill` | App → Bridge | Kill AgentAPI, revert to shell |
| `pty_input` | App → Bridge | Terminal input |
| `pty_output` | Bridge → App | Terminal output |
| `pty_resize` | App → Bridge | Terminal resize |
| `chat_send` | App → Bridge | Send chat message (user type) |
| `chat_raw` | App → Bridge | Send raw keystrokes |
| `chat_event` | Bridge → App | Chat event (SSE forwarded) |
| `chat_status` | App → Bridge | Request agent status |
| `chat_status_result` | Bridge → App | Agent status response |
| `chat_history` | App → Bridge | Request message history |
| `chat_messages` | Bridge → App | Message history response |
| `error` | Bridge → App | Error notification |

### Key Payloads

```typescript
// Process Creation (always shell first)
interface ProcessCreatePayload {
  cwd?: string;  // Optional working directory
}

interface ProcessCreatedPayload {
  id: string;
  type: 'shell';  // Always shell on creation
  cwd: string;
  ptyReady: boolean;
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
  type: 'shell' | 'claude';
  shellPid: number;         // Shell/PTY process PID (always present)
  agentApiPid?: number;     // AgentAPI server PID (only for Claude)
  port?: number;            // null when reverted to shell
  ptyReady: boolean;
  agentApiReady: boolean;   // false when reverted to shell
}

// Host Status (with existing processes)
interface HostStatusPayload {
  hostId: string;
  connected: boolean;
  processes: ProcessInfo[];
  staleProcesses?: StaleProcess[];  // Detected but not connectable
  error?: string;
}
```

### Bridge Provider

```typescript
// providers/BridgeProvider.tsx

interface BridgeContext {
  connected: boolean;
  sendMessage(message: BridgeMessage): void;
  addMessageHandler(type: string, handler: MessageHandler): () => void;
}

function BridgeProvider({ children }: { children: React.ReactNode }) {
  // WebSocket connection to Bridge
  // Auto-reconnect with exponential backoff
  // Message routing to handlers
}
```

### Message Creators

```typescript
// lib/protocol.ts

function createAuthMessage(token?: string): BridgeMessage;
function createHostConnectMessage(payload: HostConnectPayload): BridgeMessage;
function createHostDisconnectMessage(hostId: string): BridgeMessage;
function createProcessCreateMessage(cwd?: string): BridgeMessage;
function createProcessSelectMessage(processId: string): BridgeMessage;
function createProcessKillMessage(processId: string): BridgeMessage;
function createClaudeStartMessage(processId: string): BridgeMessage;
function createClaudeKillMessage(processId: string): BridgeMessage;
function createPtyInputMessage(processId: string, data: string): BridgeMessage;
function createPtyResizeMessage(processId: string, rows: number, cols: number): BridgeMessage;
function createChatSendMessage(processId: string, content: string): BridgeMessage;
function createChatRawMessage(processId: string, content: string): BridgeMessage;
function createChatStatusMessage(processId: string): BridgeMessage;
function createChatHistoryMessage(processId: string): BridgeMessage;
```

---

## File Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx              # Root layout
│   └── (tabs)/
│       ├── _layout.tsx          # Tab layout with responsive sidebar
│       ├── index.tsx            # Hosts tab
│       ├── chat.tsx             # Chat tab
│       ├── terminal.tsx         # Terminal tab
│       └── settings.tsx         # Settings tab
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx          # Desktop/tablet sidebar
│   │   └── BottomTabBar.tsx     # Mobile bottom tabs
│   ├── hosts/
│   │   ├── HostCard.tsx
│   │   ├── HostList.tsx
│   │   └── AddHostModal.tsx
│   ├── process/
│   │   ├── ProcessCard.tsx
│   │   ├── ProcessList.tsx
│   │   ├── ProcessHeader.tsx
│   │   └── ProcessStatusBadge.tsx
│   ├── terminal/
│   │   ├── TerminalView.web.tsx      # xterm.js (web)
│   │   ├── TerminalView.native.tsx   # FlatList (native)
│   │   ├── TerminalInputBar.tsx
│   │   └── AnsiStyleHelper.ts
│   └── chat/
│       ├── ChatView.tsx
│       ├── ChatInputBar.tsx
│       ├── MessageList.tsx
│       └── RawScreenModal.tsx
├── hooks/
│   ├── useResponsiveLayout.ts
│   ├── useBridgeMessages.ts
│   ├── useTerminal.ts
│   └── useProcess.ts
├── stores/
│   ├── connection.ts
│   ├── hosts.ts
│   ├── process.ts
│   ├── terminal.ts
│   ├── chat.ts
│   ├── settings.ts
│   └── layout.ts
├── lib/
│   ├── protocol.ts              # Message types & creators
│   ├── breakpoints.ts           # Responsive breakpoints
│   ├── keyCodes.ts              # Terminal escape sequences
│   └── constants.ts
└── providers/
    └── BridgeProvider.tsx
```

---

## Styling

### Color Palette

**Dark Theme (Primary):**
```typescript
const DARK = {
  background: '#1E1E1E',
  surface: '#2D2D2D',
  border: '#3C3C3C',
  text: '#D4D4D4',
  textSecondary: '#808080',
  accent: '#007ACC',
  success: '#0DBC79',
  warning: '#E5E510',
  error: '#CD3131',
};
```

**Light Theme:**
```typescript
const LIGHT = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  border: '#E5E5EA',
  text: '#333333',
  textSecondary: '#666666',
  accent: '#007AFF',
  success: '#34C759',
  warning: '#FFCC00',
  error: '#FF3B30',
};
```

### Typography

```typescript
const FONTS = {
  terminal: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  system: Platform.OS === 'ios' ? 'System' : 'Roboto',
};

const FONT_SIZES = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
};
```

---

## Error Handling (per ARCHITECTURE.md)

### Connection Errors
- **SSH connection failure**: Retry with exponential backoff
- **Bridge connection lost**: Auto-reconnect, show reconnecting indicator
- **AgentAPI not responding**: Mark as stale, prompt user to kill

### Process Errors
- **Port already in use**: Bridge tries next available port (3284-3299)
- **AgentAPI crash**: Detect via PTY output, update process status
- **Max processes reached**: Show error when all 16 ports (3284-3299) are in use

### Recovery
- On reconnect, Bridge scans for existing servers
- App prompts user about stale processes
- Re-establish PTY connections where possible

---

## Performance Considerations

### Terminal Optimization

1. **Virtualized rendering** - Only render visible lines
2. **Memoized line components** - Prevent re-renders
3. **Throttled updates** - Batch rapid output (16ms)
4. **History trimming** - Max 1MB per process

### Chat Optimization

1. **Throttled message updates** - 100ms during streaming
2. **Virtualized message list** - For long conversations
3. **Smart auto-scroll** - Only when at bottom

### Memory Management

1. **Process history limits** - 1MB per process, auto-trim
2. **Image/file cleanup** - Release after upload
3. **WebSocket reconnection** - Clean up old connections

---

## Accessibility

- **VoiceOver/TalkBack**: Proper labels on all interactive elements
- **Dynamic Type**: Text scales with system settings
- **High Contrast**: Support for increased contrast mode
- **Keyboard Navigation**: Full keyboard support on web/tablet
- **Haptic Feedback**: Optional vibration on actions (native)

---

## Testing Strategy

### Unit Tests
- Store logic (Zustand)
- Protocol message creation
- ANSI parsing

### Integration Tests
- Bridge message flow
- Terminal input/output
- Process lifecycle

### E2E Tests (Playwright)
- Full user flows
- Cross-platform consistency
- Responsive layout verification
