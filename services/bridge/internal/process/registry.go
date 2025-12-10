package process

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/agentapi"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/protocol"
	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/pty"
)

const (
	// Port range for AgentAPI servers (3284-3299, 16 ports)
	MinPort = 3284
	MaxPort = 3299
)

// ProcessType represents the type of process
type ProcessType string

const (
	TypeShell  ProcessType = "shell"
	TypeClaude ProcessType = "claude"
)

// Process represents a managed process (shell or Claude)
type Process struct {
	ID            string
	Type          ProcessType
	HostID        string
	PTY           *pty.Session
	Port          *int        // AgentAPI port (only for Claude)
	CWD           string
	StartedAt     time.Time
	ShellPID      *int        // Shell process PID on remote
	AgentAPIPID   *int        // AgentAPI server PID (only for Claude)

	// AgentAPI clients (only for Claude processes)
	AgentClient *agentapi.Client
	SSEClient   *agentapi.SSEClient

	// State flags
	PtyReady      bool
	AgentAPIReady bool

	mu sync.Mutex
}

// Registry manages all processes across hosts
type Registry struct {
	processes     sync.Map // map[processID]*Process
	hostProcesses sync.Map // map[hostID][]processID
	portPool      *PortPool
	mu            sync.Mutex
}

// PortPool manages port allocation for AgentAPI servers
type PortPool struct {
	ports map[int]bool // port -> inUse
	mu    sync.Mutex
}

// NewPortPool creates a new port pool
func NewPortPool() *PortPool {
	pool := &PortPool{
		ports: make(map[int]bool),
	}
	// Initialize all ports as available
	for port := MinPort; port <= MaxPort; port++ {
		pool.ports[port] = false
	}
	return pool
}

// Allocate allocates an available port
func (p *PortPool) Allocate() (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for port := MinPort; port <= MaxPort; port++ {
		if !p.ports[port] {
			p.ports[port] = true
			log.Printf("[DEBUG] [PORT] Allocated port %d", port)
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available ports in range %d-%d", MinPort, MaxPort)
}

// Release releases a port back to the pool
func (p *PortPool) Release(port int) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if port >= MinPort && port <= MaxPort {
		p.ports[port] = false
		log.Printf("[DEBUG] [PORT] Released port %d", port)
	}
}

// IsInUse checks if a port is in use
func (p *PortPool) IsInUse(port int) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ports[port]
}

// AvailableCount returns the number of available ports
func (p *PortPool) AvailableCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	count := 0
	for _, inUse := range p.ports {
		if !inUse {
			count++
		}
	}
	return count
}

// NewRegistry creates a new process registry
func NewRegistry() *Registry {
	return &Registry{
		portPool: NewPortPool(),
	}
}

// Register registers a new process
func (r *Registry) Register(proc *Process) {
	r.processes.Store(proc.ID, proc)

	// Track by host
	r.mu.Lock()
	defer r.mu.Unlock()

	var hostProcs []string
	if val, ok := r.hostProcesses.Load(proc.HostID); ok {
		hostProcs = val.([]string)
	}
	hostProcs = append(hostProcs, proc.ID)
	r.hostProcesses.Store(proc.HostID, hostProcs)

	log.Printf("[DEBUG] [REGISTRY] Registered process %s (type=%s, hostID=%s)",
		proc.ID, proc.Type, proc.HostID)
}

// Unregister removes a process from the registry
func (r *Registry) Unregister(processID string) {
	procVal, ok := r.processes.Load(processID)
	if !ok {
		return
	}
	proc := procVal.(*Process)

	// Release port if allocated
	if proc.Port != nil {
		r.portPool.Release(*proc.Port)
	}

	// Remove from processes map
	r.processes.Delete(processID)

	// Remove from host processes list
	r.mu.Lock()
	defer r.mu.Unlock()

	if val, ok := r.hostProcesses.Load(proc.HostID); ok {
		hostProcs := val.([]string)
		newProcs := make([]string, 0, len(hostProcs)-1)
		for _, id := range hostProcs {
			if id != processID {
				newProcs = append(newProcs, id)
			}
		}
		if len(newProcs) > 0 {
			r.hostProcesses.Store(proc.HostID, newProcs)
		} else {
			r.hostProcesses.Delete(proc.HostID)
		}
	}

	log.Printf("[DEBUG] [REGISTRY] Unregistered process %s", processID)
}

// Get retrieves a process by ID
func (r *Registry) Get(processID string) *Process {
	if val, ok := r.processes.Load(processID); ok {
		return val.(*Process)
	}
	return nil
}

// GetByHost returns all processes for a host
func (r *Registry) GetByHost(hostID string) []*Process {
	r.mu.Lock()
	procIDs, ok := r.hostProcesses.Load(hostID)
	r.mu.Unlock()

	if !ok {
		return nil
	}

	var procs []*Process
	for _, id := range procIDs.([]string) {
		if proc := r.Get(id); proc != nil {
			procs = append(procs, proc)
		}
	}
	return procs
}

// AllocatePort allocates a port from the pool
func (r *Registry) AllocatePort() (int, error) {
	return r.portPool.Allocate()
}

// ReleasePort releases a port back to the pool
func (r *Registry) ReleasePort(port int) {
	r.portPool.Release(port)
}

// ConvertToInfo converts a Process to protocol.ProcessInfo
func (p *Process) ToInfo() protocol.ProcessInfo {
	p.mu.Lock()
	defer p.mu.Unlock()

	info := protocol.ProcessInfo{
		ID:            p.ID,
		Type:          protocol.ProcessType(p.Type),
		HostID:        p.HostID,
		Port:          p.Port,
		CWD:           p.CWD,
		PtyReady:      p.PtyReady,
		AgentAPIReady: p.AgentAPIReady,
		StartedAt:     p.StartedAt.Format(time.RFC3339),
		ShellPID:      p.ShellPID,
		AgentAPIPID:   p.AgentAPIPID,
	}
	return info
}

// UpdateType changes the process type (for shell->claude conversion)
func (p *Process) UpdateType(newType ProcessType) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Type = newType
	log.Printf("[DEBUG] [PROCESS] Updated process %s type to %s", p.ID, newType)
}

// SetPort sets the AgentAPI port for the process
func (p *Process) SetPort(port int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Port = &port
}

// SetAgentAPIReady sets the AgentAPI ready flag
func (p *Process) SetAgentAPIReady(ready bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.AgentAPIReady = ready
}

// SetPtyReady sets the PTY ready flag
func (p *Process) SetPtyReady(ready bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.PtyReady = ready
}

// SetShellPID sets the shell process PID
func (p *Process) SetShellPID(pid int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ShellPID = &pid
}

// SetAgentAPIPID sets the AgentAPI server PID
func (p *Process) SetAgentAPIPID(pid int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.AgentAPIPID = &pid
}

// Close closes the process and its resources
func (p *Process) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Close SSE client first
	if p.SSEClient != nil {
		p.SSEClient.Close()
		p.SSEClient = nil
	}

	// Close AgentAPI client
	if p.AgentClient != nil {
		p.AgentClient.Close()
		p.AgentClient = nil
	}

	// Close PTY
	if p.PTY != nil {
		return p.PTY.Close()
	}
	return nil
}

// SetAgentClients sets the AgentAPI clients for this process
func (p *Process) SetAgentClients(client *agentapi.Client, sse *agentapi.SSEClient) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.AgentClient = client
	p.SSEClient = sse
}

// ClearAgentClients closes and removes AgentAPI clients
func (p *Process) ClearAgentClients() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.SSEClient != nil {
		p.SSEClient.Close()
		p.SSEClient = nil
	}
	if p.AgentClient != nil {
		p.AgentClient.Close()
		p.AgentClient = nil
	}
}

// Count returns total number of registered processes
func (r *Registry) Count() int {
	count := 0
	r.processes.Range(func(key, value interface{}) bool {
		count++
		return true
	})
	return count
}

// Close closes all processes and cleans up
func (r *Registry) Close() {
	log.Printf("[INFO] [REGISTRY] Closing all processes")
	r.processes.Range(func(key, value interface{}) bool {
		proc := value.(*Process)
		proc.Close()
		return true
	})
}
