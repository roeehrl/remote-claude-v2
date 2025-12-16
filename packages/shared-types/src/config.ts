/**
 * Configuration types for Remote Claude V2
 */

// ============================================================================
// Bridge Configuration
// ============================================================================

export interface BridgeConfig {
  url: string; // WebSocket URL, e.g., "ws://192.168.1.100:8080/ws"
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_BRIDGE_PORT = 8080;
export const AGENTAPI_PORT_MIN = 3284;
export const AGENTAPI_PORT_MAX = 3299;
