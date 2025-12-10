import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// Types
// ============================================================================

interface LayoutState {
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleContextPanel: () => void;
  setContextPanelCollapsed: (collapsed: boolean) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      contextPanelCollapsed: false,

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      toggleContextPanel: () =>
        set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),

      setContextPanelCollapsed: (collapsed) =>
        set({ contextPanelCollapsed: collapsed }),
    }),
    {
      name: 'layout-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectSidebarCollapsed = (state: LayoutState) => state.sidebarCollapsed;
export const selectContextPanelCollapsed = (state: LayoutState) => state.contextPanelCollapsed;
