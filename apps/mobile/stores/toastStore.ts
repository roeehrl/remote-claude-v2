import { create } from 'zustand';
import { ToastData, ToastType } from '@/components/common/Toast';

// ============================================================================
// Types
// ============================================================================

export interface ToastStoreState {
  toasts: ToastData[];

  // Actions
  addToast: (type: ToastType, title: string, message?: string, duration?: number) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  // Convenience methods
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

// ============================================================================
// Store
// ============================================================================

let toastIdCounter = 0;

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  addToast: (type, title, message, duration) => {
    const id = `toast-${++toastIdCounter}`;
    const toast: ToastData = {
      id,
      type,
      title,
      message,
      duration,
    };

    set((state) => ({
      toasts: [...state.toasts, toast],
    }));
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => {
    set({ toasts: [] });
  },

  success: (title, message) => {
    get().addToast('success', title, message);
  },

  error: (title, message) => {
    get().addToast('error', title, message);
  },

  warning: (title, message) => {
    get().addToast('warning', title, message);
  },

  info: (title, message) => {
    get().addToast('info', title, message);
  },
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectToasts = (state: ToastStoreState) => state.toasts;
