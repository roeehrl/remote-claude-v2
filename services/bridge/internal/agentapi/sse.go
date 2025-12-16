package agentapi

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// EventType represents the type of SSE event
type EventType string

const (
	EventMessageUpdate EventType = "message_update"
	EventStatusChange  EventType = "status_change"
)

// SSEEvent represents a parsed SSE event
type SSEEvent struct {
	Type EventType
	Data json.RawMessage
}

// MessageUpdateData represents message_update event data
type MessageUpdateData struct {
	ID      int    `json:"id"`
	Role    string `json:"role"` // "user" or "assistant"
	Message string `json:"message"`
	Time    string `json:"time"` // ISO timestamp
}

// StatusChangeData represents status_change event data
type StatusChangeData struct {
	Status    string `json:"status"` // "running" or "stable"
	AgentType string `json:"agent_type"`
}

// EventHandler is called when an SSE event is received
type EventHandler func(event SSEEvent)

// SSEClient manages an SSE connection to AgentAPI /events endpoint
type SSEClient struct {
	httpClient *http.Client
	baseURL    string
	port       int

	ctx        context.Context
	cancel     context.CancelFunc
	handler    EventHandler
	connected  bool
	mu         sync.Mutex
	reconnects int
}

// NewSSEClient creates a new SSE client for AgentAPI events
func NewSSEClient(sshClient *gossh.Client, port int, handler EventHandler) *SSEClient {
	httpClient := ssh.TunnelHTTPClient(sshClient)
	// SSE connections need longer timeout
	httpClient.Timeout = 0 // No timeout for SSE

	ctx, cancel := context.WithCancel(context.Background())

	return &SSEClient{
		httpClient: httpClient,
		baseURL:    fmt.Sprintf("http://localhost:%d", port),
		port:       port,
		ctx:        ctx,
		cancel:     cancel,
		handler:    handler,
	}
}

// Connect starts the SSE connection
func (c *SSEClient) Connect() error {
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	go c.connectionLoop()
	return nil
}

// connectionLoop handles connection and reconnection with backoff
func (c *SSEClient) connectionLoop() {
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
		}

		err := c.connectAndRead()
		if err != nil {
			if c.ctx.Err() != nil {
				// Context cancelled, exit gracefully
				return
			}

			c.reconnects++
			log.Printf("[WARN] [SSE] Connection failed (attempt %d): %v, retrying in %v",
				c.reconnects, err, backoff)

			select {
			case <-c.ctx.Done():
				return
			case <-time.After(backoff):
			}

			// Exponential backoff
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		} else {
			// Successful connection, reset backoff
			backoff = time.Second
			c.reconnects = 0
		}
	}
}

// connectAndRead establishes SSE connection and reads events
func (c *SSEClient) connectAndRead() error {
	url := c.baseURL + "/events"
	log.Printf("[DEBUG] [SSE] Connecting to %s", url)

	req, err := http.NewRequestWithContext(c.ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	c.mu.Lock()
	c.connected = true
	c.mu.Unlock()

	log.Printf("[INFO] [SSE] Connected to %s", url)

	defer func() {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
	}()

	return c.readEvents(resp.Body)
}

// readEvents reads and parses SSE events from the response body
func (c *SSEClient) readEvents(body io.Reader) error {
	reader := bufio.NewReader(body)

	var eventType string
	var dataLines []string

	for {
		select {
		case <-c.ctx.Done():
			return nil
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				return fmt.Errorf("connection closed")
			}
			return fmt.Errorf("read error: %w", err)
		}

		line = strings.TrimRight(line, "\r\n")

		if line == "" {
			// Empty line marks end of event
			if eventType != "" && len(dataLines) > 0 {
				data := strings.Join(dataLines, "\n")
				c.handleEvent(eventType, data)
			}
			eventType = ""
			dataLines = nil
			continue
		}

		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			data := strings.TrimPrefix(line, "data:")
			if len(data) > 0 && data[0] == ' ' {
				data = data[1:] // Remove optional leading space
			}
			dataLines = append(dataLines, data)
		}
		// Ignore other fields like id:, retry:, comments (lines starting with :)
	}
}

// handleEvent processes a received event
func (c *SSEClient) handleEvent(eventType, data string) {
	log.Printf("[DEBUG] [SSE] Received event: type=%s", eventType)

	event := SSEEvent{
		Type: EventType(eventType),
		Data: json.RawMessage(data),
	}

	if c.handler != nil {
		c.handler(event)
	}
}

// IsConnected returns whether the SSE connection is active
func (c *SSEClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// SetHandler updates the event handler (used when session reconnects)
func (c *SSEClient) SetHandler(handler EventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handler = handler
}

// Close terminates the SSE connection
func (c *SSEClient) Close() {
	log.Printf("[DEBUG] [SSE] Closing connection to port %d", c.port)
	c.cancel()
	c.httpClient.CloseIdleConnections()
}

// Port returns the port this client connects to
func (c *SSEClient) Port() int {
	return c.port
}
