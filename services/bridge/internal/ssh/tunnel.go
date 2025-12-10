package ssh

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"time"

	"golang.org/x/crypto/ssh"
)

// TunnelTransport creates an http.Transport that routes requests through an SSH tunnel
// This is CRITICAL for security - AgentAPI has no authentication and must only be accessed
// through the SSH tunnel
type TunnelTransport struct {
	sshClient *ssh.Client
}

// NewTunnelTransport creates a new transport that tunnels HTTP through SSH
func NewTunnelTransport(sshClient *ssh.Client) *TunnelTransport {
	return &TunnelTransport{
		sshClient: sshClient,
	}
}

// RoundTrip implements http.RoundTripper
func (t *TunnelTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Create a custom transport that dials through SSH
	transport := &http.Transport{
		DialContext: nil, // Not used, we override Dial
		Dial: func(network, addr string) (net.Conn, error) {
			log.Printf("[DEBUG] [SSH-TUNNEL] Dialing %s through SSH tunnel", addr)
			conn, err := t.sshClient.Dial(network, addr)
			if err != nil {
				log.Printf("[ERROR] [SSH-TUNNEL] Failed to dial %s: %v", addr, err)
				return nil, err
			}
			return conn, nil
		},
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableKeepAlives:     true, // Simpler connection handling through tunnel
	}

	return transport.RoundTrip(req)
}

// TunnelHTTPClient creates an HTTP client that routes all requests through the SSH tunnel
func TunnelHTTPClient(sshClient *ssh.Client) *http.Client {
	return &http.Client{
		Transport: NewTunnelTransport(sshClient),
		Timeout:   60 * time.Second,
	}
}

// TunneledClient wraps an SSH connection with AgentAPI-specific HTTP client
type TunneledClient struct {
	SSHClient  *ssh.Client
	HTTPClient *http.Client
	Port       int
	BaseURL    string
}

// NewTunneledClient creates a new tunneled client for AgentAPI access
func NewTunneledClient(sshClient *ssh.Client, port int) *TunneledClient {
	httpClient := TunnelHTTPClient(sshClient)

	return &TunneledClient{
		SSHClient:  sshClient,
		HTTPClient: httpClient,
		Port:       port,
		BaseURL:    fmt.Sprintf("http://localhost:%d", port),
	}
}

// Get performs a GET request through the tunnel
func (c *TunneledClient) Get(path string) (*http.Response, error) {
	url := c.BaseURL + path
	log.Printf("[DEBUG] [SSH-TUNNEL] GET %s", url)
	return c.HTTPClient.Get(url)
}

// Post performs a POST request through the tunnel
func (c *TunneledClient) Post(path, contentType string, body []byte) (*http.Response, error) {
	url := c.BaseURL + path
	log.Printf("[DEBUG] [SSH-TUNNEL] POST %s", url)

	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)

	if body != nil {
		req.Body = newBytesReadCloser(body)
		req.ContentLength = int64(len(body))
	}

	return c.HTTPClient.Do(req)
}

// Close closes the tunneled client (does not close the SSH connection)
func (c *TunneledClient) Close() {
	c.HTTPClient.CloseIdleConnections()
}

// bytesReadCloser wraps a byte slice as io.ReadCloser
type bytesReadCloser struct {
	data   []byte
	offset int
}

func newBytesReadCloser(data []byte) *bytesReadCloser {
	return &bytesReadCloser{data: data}
}

func (b *bytesReadCloser) Read(p []byte) (n int, err error) {
	if b.offset >= len(b.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, b.data[b.offset:])
	b.offset += n
	return n, nil
}

func (b *bytesReadCloser) Close() error {
	return nil
}
