package agentapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/roeeharel/remote-claude-v2/services/bridge/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// Client provides access to AgentAPI endpoints through SSH tunnel
// CRITICAL: All HTTP requests go through the SSH tunnel for security
type Client struct {
	httpClient *http.Client
	baseURL    string
	port       int
}

// StatusResponse represents the /status endpoint response
type StatusResponse struct {
	Status    string `json:"status"` // "running" or "stable"
	AgentType string `json:"agent_type"`
}

// Message represents a chat message
type Message struct {
	ID      int    `json:"id"`
	Role    string `json:"role"` // "user" or "assistant"
	Message string `json:"message"`
	Time    string `json:"time"` // ISO timestamp
}

// MessagesResponse represents the /messages endpoint response
type MessagesResponse struct {
	Messages []Message `json:"messages"`
}

// MessageRequest represents a POST /message request body
type MessageRequest struct {
	Type    string `json:"type"` // "user" or "raw"
	Content string `json:"content"`
}

// UploadResponse represents the /upload endpoint response
type UploadResponse struct {
	Success  bool   `json:"success"`
	Filename string `json:"filename,omitempty"`
	Error    string `json:"error,omitempty"`
}

// NewClient creates a new AgentAPI client that communicates through SSH tunnel
func NewClient(sshClient *gossh.Client, port int) *Client {
	httpClient := ssh.TunnelHTTPClient(sshClient)
	httpClient.Timeout = 30 * time.Second

	return &Client{
		httpClient: httpClient,
		baseURL:    fmt.Sprintf("http://localhost:%d", port),
		port:       port,
	}
}

// GetStatus retrieves the current agent status
func (c *Client) GetStatus() (*StatusResponse, error) {
	url := c.baseURL + "/status"
	log.Printf("[DEBUG] [AGENTAPI] GET %s", url)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status request failed: %d %s", resp.StatusCode, string(body))
	}

	var status StatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("failed to parse status response: %w", err)
	}

	return &status, nil
}

// GetMessages retrieves all chat messages
func (c *Client) GetMessages() ([]Message, error) {
	url := c.baseURL + "/messages"
	log.Printf("[DEBUG] [AGENTAPI] GET %s", url)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("messages request failed: %d %s", resp.StatusCode, string(body))
	}

	var messagesResp MessagesResponse
	if err := json.NewDecoder(resp.Body).Decode(&messagesResp); err != nil {
		return nil, fmt.Errorf("failed to parse messages response: %w", err)
	}

	return messagesResp.Messages, nil
}

// SendMessage sends a user message (only when agent is stable)
func (c *Client) SendMessage(content string) error {
	return c.postMessage(MessageRequest{
		Type:    "user",
		Content: content,
	})
}

// SendRaw sends a raw input (allowed in any state)
func (c *Client) SendRaw(content string) error {
	return c.postMessage(MessageRequest{
		Type:    "raw",
		Content: content,
	})
}

// postMessage sends a POST /message request
func (c *Client) postMessage(req MessageRequest) error {
	url := c.baseURL + "/message"
	log.Printf("[DEBUG] [AGENTAPI] POST %s type=%s", url, req.Type)

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("message request failed: %d %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// Upload uploads a file to the agent
func (c *Client) Upload(filename string, data []byte) (*UploadResponse, error) {
	url := c.baseURL + "/upload"
	log.Printf("[DEBUG] [AGENTAPI] POST %s filename=%s size=%d", url, filename, len(data))

	// Create multipart form
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := part.Write(data); err != nil {
		return nil, fmt.Errorf("failed to write file data: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to upload file: %w", err)
	}
	defer resp.Body.Close()

	var uploadResp UploadResponse
	if err := json.NewDecoder(resp.Body).Decode(&uploadResp); err != nil {
		return nil, fmt.Errorf("failed to parse upload response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return &uploadResp, fmt.Errorf("upload failed: %s", uploadResp.Error)
	}

	return &uploadResp, nil
}

// Close closes the client
func (c *Client) Close() {
	c.httpClient.CloseIdleConnections()
}

// Port returns the port this client connects to
func (c *Client) Port() int {
	return c.port
}
