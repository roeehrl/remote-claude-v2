import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// Types
// ============================================================================

export interface SettingsState {
  // Bridge connection
  bridgeUrl: string;
  bridgeAutoConnect: boolean; // Auto-connect to bridge on app start

  // Appearance
  fontSize: number;

  // Actions
  setBridgeUrl: (url: string) => void;
  setBridgeAutoConnect: (autoConnect: boolean) => void;
  setFontSize: (size: number) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Initial state
      bridgeUrl: 'ws://localhost:8080/ws',
      bridgeAutoConnect: false, // Default: don't auto-connect
      fontSize: 14,

      // Actions
      setBridgeUrl: (url: string) => {
        set({ bridgeUrl: url });
      },

      setBridgeAutoConnect: (autoConnect: boolean) => {
        set({ bridgeAutoConnect: autoConnect });
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
export const selectFontSize = (state: SettingsState) => state.fontSize;
