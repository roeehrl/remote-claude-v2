import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export interface TerminalBuffer {
  processId: string;
  lines: string[];       // Array of output lines
  rawOutput: string;     // Complete raw output for replay
  scrollPosition: number; // For restoring scroll position
}

export interface TerminalStoreState {
  // Buffers keyed by processId
  buffers: Map<string, TerminalBuffer>;

  // Actions
  appendOutput: (processId: string, data: string) => void;
  clearBuffer: (processId: string) => void;
  setScrollPosition: (processId: string, position: number) => void;
  getBuffer: (processId: string) => TerminalBuffer | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_LINES = 10000;  // Maximum lines to keep in buffer
const MAX_RAW_SIZE = 1024 * 1024; // 1MB max raw output

// ============================================================================
// Store
// ============================================================================

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  buffers: new Map(),

  appendOutput: (processId: string, data: string) => {
    set(state => {
      const newBuffers = new Map(state.buffers);
      const existing = newBuffers.get(processId);

      if (existing) {
        // Append to existing buffer
        const newRaw = existing.rawOutput + data;
        const newLines = [...existing.lines];

        // Parse new data into lines
        const parts = data.split('\n');
        if (parts.length > 0) {
          // Append to last line if it didn't end with newline
          if (newLines.length > 0 && !existing.rawOutput.endsWith('\n')) {
            newLines[newLines.length - 1] += parts[0];
            parts.shift();
          }
          // Add remaining lines
          newLines.push(...parts);
        }

        // Trim if too many lines
        const trimmedLines = newLines.length > MAX_LINES
          ? newLines.slice(-MAX_LINES)
          : newLines;

        // Trim raw output if too large
        const trimmedRaw = newRaw.length > MAX_RAW_SIZE
          ? newRaw.slice(-MAX_RAW_SIZE)
          : newRaw;

        newBuffers.set(processId, {
          ...existing,
          lines: trimmedLines,
          rawOutput: trimmedRaw,
        });
      } else {
        // Create new buffer
        const lines = data.split('\n');
        newBuffers.set(processId, {
          processId,
          lines,
          rawOutput: data,
          scrollPosition: 0,
        });
      }

      return { buffers: newBuffers };
    });
  },

  clearBuffer: (processId: string) => {
    set(state => {
      const newBuffers = new Map(state.buffers);
      newBuffers.delete(processId);
      return { buffers: newBuffers };
    });
  },

  setScrollPosition: (processId: string, position: number) => {
    set(state => {
      const newBuffers = new Map(state.buffers);
      const existing = newBuffers.get(processId);
      if (existing) {
        newBuffers.set(processId, { ...existing, scrollPosition: position });
      }
      return { buffers: newBuffers };
    });
  },

  getBuffer: (processId: string) => {
    return get().buffers.get(processId);
  },
}));

// ============================================================================
// Selectors
// ============================================================================

// Stable empty array to avoid creating new reference on each call
const EMPTY_LINES: string[] = [];

export const selectBuffer = (processId: string) => (state: TerminalStoreState) =>
  state.buffers.get(processId);

export const selectBufferLines = (processId: string) => (state: TerminalStoreState) =>
  state.buffers.get(processId)?.lines ?? EMPTY_LINES;
