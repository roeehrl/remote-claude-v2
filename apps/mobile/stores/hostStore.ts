import { create } from 'zustand';
import {
  ProcessInfo,
  StaleProcess,
  HostStatusPayload,
  ProcessCreatedPayload,
  ProcessKilledPayload,
  ProcessUpdatedPayload,
  HostRequirements,
} from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

export type HostConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectedHost {
  id: string;           // hostId from settings
  state: HostConnectionState;
  processes: ProcessInfo[];
  staleProcesses: StaleProcess[];
  error?: string;
  requirements?: HostRequirements;
  requirementsChecking?: boolean;
}

export interface HostStoreState {
  // Connected hosts
  hosts: Map<string, ConnectedHost>;

  // Currently selected process
  selectedProcessId: string | null;

  // Actions
  setHostConnecting: (hostId: string) => void;
  setHostConnected: (hostId: string, processes: ProcessInfo[], staleProcesses?: StaleProcess[], requirements?: HostRequirements) => void;
  setHostDisconnected: (hostId: string) => void;
  setHostError: (hostId: string, error: string) => void;
  setHostRequirements: (hostId: string, requirements: HostRequirements) => void;
  setHostRequirementsChecking: (hostId: string, checking: boolean) => void;

  // Process actions
  addProcess: (process: ProcessInfo) => void;
  updateProcess: (update: ProcessUpdatedPayload) => void;
  removeProcess: (processId: string) => void;
  selectProcess: (processId: string | null) => void;

  // Helpers
  getHost: (hostId: string) => ConnectedHost | undefined;
  getProcess: (processId: string) => ProcessInfo | undefined;
  getSelectedProcess: () => ProcessInfo | undefined;
}

// ============================================================================
// Store
// ============================================================================

export const useHostStore = create<HostStoreState>((set, get) => ({
  hosts: new Map(),
  selectedProcessId: null,

  // Host state management
  setHostConnecting: (hostId: string) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      newHosts.set(hostId, {
        id: hostId,
        state: 'connecting',
        processes: [],
        staleProcesses: [],
      });
      return { hosts: newHosts };
    });
  },

  setHostConnected: (hostId: string, processes: ProcessInfo[], staleProcesses: StaleProcess[] = [], requirements?: HostRequirements) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      newHosts.set(hostId, {
        id: hostId,
        state: 'connected',
        processes,
        staleProcesses,
        requirements,
      });
      return { hosts: newHosts };
    });
  },

  setHostDisconnected: (hostId: string) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      newHosts.delete(hostId);

      // Clear selected process if it belonged to this host
      const selectedProcess = get().getProcess(state.selectedProcessId ?? '');
      const newSelectedId = selectedProcess?.hostId === hostId ? null : state.selectedProcessId;

      return { hosts: newHosts, selectedProcessId: newSelectedId };
    });
  },

  setHostError: (hostId: string, error: string) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      const existing = newHosts.get(hostId);
      if (existing) {
        newHosts.set(hostId, { ...existing, state: 'error', error });
      } else {
        newHosts.set(hostId, {
          id: hostId,
          state: 'error',
          processes: [],
          staleProcesses: [],
          error,
        });
      }
      return { hosts: newHosts };
    });
  },

  setHostRequirements: (hostId: string, requirements: HostRequirements) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      const existing = newHosts.get(hostId);
      if (existing) {
        newHosts.set(hostId, { ...existing, requirements, requirementsChecking: false });
      }
      return { hosts: newHosts };
    });
  },

  setHostRequirementsChecking: (hostId: string, checking: boolean) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      const existing = newHosts.get(hostId);
      if (existing) {
        newHosts.set(hostId, { ...existing, requirementsChecking: checking });
      }
      return { hosts: newHosts };
    });
  },

  // Process management
  addProcess: (process: ProcessInfo) => {
    set(state => {
      const newHosts = new Map(state.hosts);
      const host = newHosts.get(process.hostId);
      if (host) {
        newHosts.set(process.hostId, {
          ...host,
          processes: [...(host.processes || []), process],
        });
      }
      return { hosts: newHosts };
    });
  },

  updateProcess: (update: ProcessUpdatedPayload) => {
    set(state => {
      const newHosts = new Map(state.hosts);

      // Find the host containing this process
      for (const [hostId, host] of newHosts) {
        const processIndex = (host.processes || []).findIndex(p => p.id === update.id);
        if (processIndex !== -1) {
          const updatedProcesses = [...(host.processes || [])];
          updatedProcesses[processIndex] = {
            ...updatedProcesses[processIndex],
            type: update.type,
            port: update.port,
            ptyReady: update.ptyReady,
            agentApiReady: update.agentApiReady,
            shellPid: update.shellPid,
            agentApiPid: update.agentApiPid,
          };
          newHosts.set(hostId, { ...host, processes: updatedProcesses });
          break;
        }
      }

      return { hosts: newHosts };
    });
  },

  removeProcess: (processId: string) => {
    set(state => {
      const newHosts = new Map(state.hosts);

      // Find and remove the process
      for (const [hostId, host] of newHosts) {
        const processIndex = (host.processes || []).findIndex(p => p.id === processId);
        if (processIndex !== -1) {
          newHosts.set(hostId, {
            ...host,
            processes: (host.processes || []).filter(p => p.id !== processId),
          });
          break;
        }
      }

      // Clear selection if this was the selected process
      const newSelectedId = state.selectedProcessId === processId ? null : state.selectedProcessId;

      return { hosts: newHosts, selectedProcessId: newSelectedId };
    });
  },

  selectProcess: (processId: string | null) => {
    set({ selectedProcessId: processId });
  },

  // Helpers
  getHost: (hostId: string) => {
    return get().hosts.get(hostId);
  },

  getProcess: (processId: string) => {
    for (const host of get().hosts.values()) {
      const process = (host.processes || []).find(p => p.id === processId);
      if (process) return process;
    }
    return undefined;
  },

  getSelectedProcess: () => {
    const { selectedProcessId } = get();
    if (!selectedProcessId) return undefined;
    return get().getProcess(selectedProcessId);
  },
}));

// ============================================================================
// Selectors
// ============================================================================

// NOTE: These selectors return new arrays/objects - use with useShallow() to prevent infinite re-renders
// Example: const hosts = useHostStore(useShallow(selectConnectedHosts))

export const selectConnectedHosts = (state: HostStoreState) =>
  Array.from(state.hosts.values());

export const selectHostById = (hostId: string) => (state: HostStoreState) =>
  state.hosts.get(hostId);

// Selector for selected process ID only (primitive, safe to use directly)
export const selectSelectedProcessId = (state: HostStoreState) =>
  state.selectedProcessId;

// Selector for selected process - returns a stable reference if nothing changed
export const selectSelectedProcess = (state: HostStoreState) => {
  const { selectedProcessId, hosts } = state;
  if (!selectedProcessId) return undefined;
  for (const host of hosts.values()) {
    const process = (host.processes || []).find(p => p.id === selectedProcessId);
    if (process) return process;
  }
  return undefined;
};

// Selector for all processes - use with useShallow()
export const selectAllProcesses = (state: HostStoreState) => {
  const processes: ProcessInfo[] = [];
  for (const host of state.hosts.values()) {
    // Defensive: handle null/undefined processes array from Bridge
    if (host.processes) {
      processes.push(...host.processes);
    }
  }
  return processes;

};

// Selector for hosts Map (use with useShallow for stable reference)
export const selectHostsMap = (state: HostStoreState) => state.hosts;
