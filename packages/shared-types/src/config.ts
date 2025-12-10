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
// SSH Host Configuration
// ============================================================================

export type AuthType = 'password' | 'key';

export interface SSHHostConfig {
  id: string;
  name: string; // Display name, e.g., "My Dev Server"
  host: string; // SSH host, e.g., "192.168.1.100"
  port: number; // SSH port, default 22
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
}

// ============================================================================
// Full App Configuration
// ============================================================================

export interface AppConfig {
  bridge: BridgeConfig;
  sshHosts: SSHHostConfig[];
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_BRIDGE_PORT = 8080;
export const AGENTAPI_PORT_MIN = 3284;
export const AGENTAPI_PORT_MAX = 3299;
