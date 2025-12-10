import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ============================================================================
// Types
// ============================================================================

export type AuthType = 'password' | 'key';

export interface SSHHost {
  id: string;
  name: string;          // Display name
  host: string;          // Hostname or IP
  port: number;          // SSH port (usually 22)
  username: string;      // SSH username
  authType: AuthType;    // 'password' or 'key'
  autoConnect?: boolean; // Auto-reconnect on page reload (web)
  // Note: credentials stored separately in SecureStore
}

export interface SettingsState {
  // Bridge connection
  bridgeUrl: string;
  bridgeAutoConnect: boolean; // Auto-connect to bridge on app start

  // SSH Hosts
  hosts: SSHHost[];

  // Appearance
  fontSize: number;

  // Actions
  setBridgeUrl: (url: string) => void;
  setBridgeAutoConnect: (autoConnect: boolean) => void;
  addHost: (host: Omit<SSHHost, 'id'>) => string;
  updateHost: (id: string, updates: Partial<Omit<SSHHost, 'id'>>) => void;
  removeHost: (id: string) => void;
  setFontSize: (size: number) => void;
}

// ============================================================================
// Secure Storage for Credentials
// ============================================================================

// Note: expo-secure-store has restrictions on key names
// Keys must not contain special characters like @ or /
const CREDENTIAL_PREFIX = 'rc_host_cred_';

/**
 * Store credentials securely (password or private key)
 * Falls back to localStorage on web (NOT secure - development only)
 *
 * Note: expo-secure-store has limitations:
 * - Keys may only contain alphanumeric characters, `.`, `-`, and `_`
 * - Large payloads (>2048 bytes on some iOS versions) may be rejected
 */
export async function storeHostCredential(hostId: string, credential: string): Promise<void> {
  const key = `${CREDENTIAL_PREFIX}${hostId}`;

  if (Platform.OS === 'web') {
    // Web fallback - NOT secure, for development only
    console.log('[SETTINGS] Using localStorage fallback (web)');
    localStorage.setItem(key, credential);
    return;
  }

  try {
    // Check if SecureStore is available
    const isAvailable = await SecureStore.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('SecureStore is not available on this device');
    }

    await SecureStore.setItemAsync(key, credential);
    console.log('[SETTINGS] Credential stored successfully');
  } catch (error) {
    console.error('[SETTINGS] Failed to store credential:', error);
    // Re-throw with more context
    if (error instanceof Error) {
      throw new Error(`Failed to store credential: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve credentials securely
 * Falls back to localStorage on web (NOT secure - development only)
 */
export async function getHostCredential(hostId: string): Promise<string | null> {
  const key = `${CREDENTIAL_PREFIX}${hostId}`;

  if (Platform.OS === 'web') {
    // Web fallback - NOT secure, for development only
    return localStorage.getItem(key);
  }

  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.log('[SETTINGS] Failed to get credential:', error);
    return null;
  }
}

/**
 * Delete credentials securely
 * Falls back to localStorage on web
 */
export async function deleteHostCredential(hostId: string): Promise<void> {
  const key = `${CREDENTIAL_PREFIX}${hostId}`;

  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }

  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.log('[SETTINGS] Failed to delete credential:', error);
  }
}

// ============================================================================
// Generate unique ID
// ============================================================================

function generateId(): string {
  return `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Store
// ============================================================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Initial state
      bridgeUrl: 'ws://localhost:8080/ws',
      bridgeAutoConnect: false, // Default: don't auto-connect
      hosts: [],
      fontSize: 14,

      // Actions
      setBridgeUrl: (url: string) => {
        set({ bridgeUrl: url });
      },

      setBridgeAutoConnect: (autoConnect: boolean) => {
        set({ bridgeAutoConnect: autoConnect });
      },

      addHost: (host: Omit<SSHHost, 'id'>): string => {
        const id = generateId();
        const newHost: SSHHost = { ...host, id };
        set(state => ({
          hosts: [...state.hosts, newHost],
        }));
        return id;
      },

      updateHost: (id: string, updates: Partial<Omit<SSHHost, 'id'>>) => {
        set(state => ({
          hosts: state.hosts.map(h =>
            h.id === id ? { ...h, ...updates } : h
          ),
        }));
      },

      removeHost: (id: string) => {
        // Also delete the credential
        deleteHostCredential(id);
        set(state => ({
          hosts: state.hosts.filter(h => h.id !== id),
        }));
      },

      setFontSize: (size: number) => {
        set({ fontSize: Math.max(10, Math.min(24, size)) }); // Clamp 10-24
      },
    }),
    {
      name: '@remote-claude/settings',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist these keys (not functions)
      partialize: (state) => ({
        bridgeUrl: state.bridgeUrl,
        bridgeAutoConnect: state.bridgeAutoConnect,
        hosts: state.hosts,
        fontSize: state.fontSize,
      }),
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectBridgeUrl = (state: SettingsState) => state.bridgeUrl;
export const selectBridgeAutoConnect = (state: SettingsState) => state.bridgeAutoConnect;
export const selectHosts = (state: SettingsState) => state.hosts;
export const selectFontSize = (state: SettingsState) => state.fontSize;
export const selectHostById = (id: string) => (state: SettingsState) =>
  state.hosts.find(h => h.id === id);
