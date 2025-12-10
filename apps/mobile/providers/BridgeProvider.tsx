import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import {
  Message,
  MessageType,
  MessageTypes,
  Messages,
  AuthResultPayload,
  ProcessInfo,
  StaleProcess,
  HostRequirements,
  HostStatusPayload,
  ProcessCreatedPayload,
  ProcessKilledPayload,
  ProcessUpdatedPayload,
  HostRequirementsResultPayload,
} from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type HostConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type MessageHandler<T = unknown> = (message: Message<T>) => void;

// Host runtime state (server state mirrored locally)
export interface ConnectedHost {
  id: string;
  state: HostConnectionState;
  processes: ProcessInfo[];
  staleProcesses: StaleProcess[];
  error?: string;
  requirements?: HostRequirements;
  requirementsChecking?: boolean;
}

interface BridgeContextValue {
  // Bridge connection state
  connectionState: ConnectionState;
  sessionId: string | null;
  reconnectToken: string | null;

  // Connection control
  connect: (url: string) => void;
  disconnect: () => void;

  // Messaging
  sendMessage: <T>(message: Message<T>) => void;
  addMessageHandler: (type: MessageType, handler: MessageHandler) => () => void;

  // Server state (read-only, received from bridge)
  hosts: Map<string, ConnectedHost>;

  // Client state (UI selection)
  selectedProcessId: string | null;
  selectProcess: (processId: string | null) => void;

  // Host state mutations (triggered by bridge messages, exposed for UI feedback)
  setHostConnecting: (hostId: string) => void;
  setHostDisconnected: (hostId: string) => void;
  setHostError: (hostId: string, error: string) => void;
  setHostRequirementsChecking: (hostId: string, checking: boolean) => void;
}

interface BridgeProviderProps {
  children: ReactNode;
  autoConnect?: boolean;
  defaultUrl?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MIN_RECONNECT_DELAY = 1000;  // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const RECONNECT_MULTIPLIER = 2;

// Debug logging helper
const log = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', tag: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}] [${tag}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
};

// ============================================================================
// Context
// ============================================================================

const BridgeContext = createContext<BridgeContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function BridgeProvider({
  children,
  autoConnect = false,
  defaultUrl = '',
}: BridgeProviderProps) {
  // Bridge connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reconnectToken, setReconnectToken] = useState<string | null>(null);

  // Server state (hosts and processes - received from bridge)
  const [hosts, setHosts] = useState<Map<string, ConnectedHost>>(new Map());

  // Client state (UI selection)
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);
  const urlRef = useRef<string>(defaultUrl);

  // Reconnection state
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);

  // Message handlers - Map of message type to Set of handlers
  const handlersRef = useRef<Map<MessageType, Set<MessageHandler>>>(new Map());

  // ============================================================================
  // Message Handling
  // ============================================================================

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as Message;
      log('DEBUG', 'BRIDGE', `Received: ${message.type}`, message.payload);

      // Get handlers for this message type
      const handlers = handlersRef.current.get(message.type);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            log('ERROR', 'BRIDGE', `Handler error for ${message.type}:`, error);
          }
        });
      }
    } catch (error) {
      log('ERROR', 'BRIDGE', 'Failed to parse message:', error);
    }
  }, []);

  // Handle auth_result internally
  const handleAuthResult = useCallback((message: Message<AuthResultPayload>) => {
    const payload = message.payload;
    if (payload.success) {
      log('INFO', 'BRIDGE', `Authenticated: sessionId=${payload.sessionId}, reconnected=${payload.reconnected}`);
      setSessionId(payload.sessionId ?? null);
      setReconnectToken(payload.reconnectToken ?? null);
      setConnectionState('connected');
      reconnectAttemptRef.current = 0;
    } else {
      log('ERROR', 'BRIDGE', `Authentication failed: ${payload.error}`);
      // Don't set disconnected - let the connection close handler do that
    }
  }, []);

  // Register internal auth handler
  useEffect(() => {
    const unsubscribe = addMessageHandler(MessageTypes.AUTH_RESULT, handleAuthResult as MessageHandler);
    return unsubscribe;
  }, [handleAuthResult]);

  // ============================================================================
  // Connection Management
  // ============================================================================

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      log('DEBUG', 'BRIDGE', 'Reconnection disabled, not scheduling');
      return;
    }

    const delay = Math.min(
      MIN_RECONNECT_DELAY * Math.pow(RECONNECT_MULTIPLIER, reconnectAttemptRef.current),
      MAX_RECONNECT_DELAY
    );

    log('INFO', 'BRIDGE', `Scheduling reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);
    setConnectionState('reconnecting');

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptRef.current++;
      connect(urlRef.current);
    }, delay);
  }, []);

  const connect = useCallback((url: string) => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    urlRef.current = url;
    shouldReconnectRef.current = true;
    setConnectionState('connecting');

    log('INFO', 'BRIDGE', `Connecting to ${url}`);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        log('INFO', 'BRIDGE', 'WebSocket connected');

        // Send auth message with reconnect token if available
        const authMessage = Messages.auth({ reconnectToken: reconnectToken ?? undefined });
        log('DEBUG', 'BRIDGE', `Sending: ${authMessage.type}`, authMessage.payload);
        ws.send(JSON.stringify(authMessage));
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        log('ERROR', 'BRIDGE', 'WebSocket error:', error);
      };

      ws.onclose = (event) => {
        log('INFO', 'BRIDGE', `WebSocket closed: code=${event.code}, reason=${event.reason}`);
        wsRef.current = null;

        if (shouldReconnectRef.current) {
          scheduleReconnect();
        } else {
          setConnectionState('disconnected');
          setSessionId(null);
        }
      };
    } catch (error) {
      log('ERROR', 'BRIDGE', 'Failed to create WebSocket:', error);
      setConnectionState('disconnected');
      scheduleReconnect();
    }
  }, [reconnectToken, handleMessage, scheduleReconnect]);

  const disconnect = useCallback(() => {
    log('INFO', 'BRIDGE', 'Disconnecting');
    shouldReconnectRef.current = false;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState('disconnected');
    setSessionId(null);
    reconnectAttemptRef.current = 0;
  }, []);

  // ============================================================================
  // Message Sending
  // ============================================================================

  const sendMessage = useCallback(<T,>(message: Message<T>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      log('WARN', 'BRIDGE', 'Cannot send message - not connected');
      return;
    }

    log('DEBUG', 'BRIDGE', `Sending: ${message.type}`, message.payload);
    wsRef.current.send(JSON.stringify(message));
  }, []);

  // ============================================================================
  // Handler Registration
  // ============================================================================

  const addMessageHandler = useCallback((type: MessageType, handler: MessageHandler): (() => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  // ============================================================================
  // Host State Management (server state mutations)
  // ============================================================================

  const setHostConnecting = useCallback((hostId: string) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      newHosts.set(hostId, {
        id: hostId,
        state: 'connecting',
        processes: [],
        staleProcesses: [],
      });
      return newHosts;
    });
  }, []);

  const setHostConnected = useCallback((
    hostId: string,
    processes: ProcessInfo[] = [],
    staleProcesses: StaleProcess[] = [],
    requirements?: HostRequirements
  ) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      newHosts.set(hostId, {
        id: hostId,
        state: 'connected',
        processes: processes ?? [],
        staleProcesses: staleProcesses ?? [],
        requirements,
      });
      return newHosts;
    });
  }, []);

  const setHostDisconnected = useCallback((hostId: string) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      // Clear selection if selected process belonged to this host
      const host = newHosts.get(hostId);
      if (host?.processes?.some(p => p.id === selectedProcessId)) {
        setSelectedProcessId(null);
      }
      newHosts.delete(hostId);
      return newHosts;
    });
  }, [selectedProcessId]);

  const setHostError = useCallback((hostId: string, error: string) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
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
      return newHosts;
    });
  }, []);

  const setHostRequirements = useCallback((hostId: string, requirements: HostRequirements) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      const existing = newHosts.get(hostId);
      if (existing) {
        newHosts.set(hostId, { ...existing, requirements, requirementsChecking: false });
      }
      return newHosts;
    });
  }, []);

  const setHostRequirementsChecking = useCallback((hostId: string, checking: boolean) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      const existing = newHosts.get(hostId);
      if (existing) {
        newHosts.set(hostId, { ...existing, requirementsChecking: checking });
      }
      return newHosts;
    });
  }, []);

  const addProcess = useCallback((process: ProcessInfo) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      const host = newHosts.get(process.hostId);
      if (host) {
        newHosts.set(process.hostId, {
          ...host,
          processes: [...(host.processes ?? []), process],
        });
      }
      return newHosts;
    });
  }, []);

  const updateProcess = useCallback((update: ProcessUpdatedPayload) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      for (const [hostId, host] of newHosts) {
        const processes = host.processes ?? [];
        const processIndex = processes.findIndex(p => p.id === update.id);
        if (processIndex !== -1) {
          const updatedProcesses = [...processes];
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
      return newHosts;
    });
  }, []);

  const removeProcess = useCallback((processId: string) => {
    setHosts(prev => {
      const newHosts = new Map(prev);
      for (const [hostId, host] of newHosts) {
        const processes = host.processes ?? [];
        const processIndex = processes.findIndex(p => p.id === processId);
        if (processIndex !== -1) {
          newHosts.set(hostId, {
            ...host,
            processes: processes.filter(p => p.id !== processId),
          });
          break;
        }
      }
      return newHosts;
    });
    // Clear selection if this was the selected process
    setSelectedProcessId(prev => prev === processId ? null : prev);
  }, []);

  const selectProcess = useCallback((processId: string | null) => {
    setSelectedProcessId(processId);
  }, []);

  // ============================================================================
  // Server State Message Handlers
  // ============================================================================

  // Handle host status updates
  useEffect(() => {
    return addMessageHandler(MessageTypes.HOST_STATUS, (msg: Message<HostStatusPayload>) => {
      const payload = msg.payload;
      if (payload.connected) {
        setHostConnected(
          payload.hostId,
          payload.processes ?? [],
          payload.staleProcesses ?? [],
          payload.requirements
        );
      } else if (payload.error) {
        setHostError(payload.hostId, payload.error);
      } else {
        setHostDisconnected(payload.hostId);
      }
    });
  }, [addMessageHandler, setHostConnected, setHostError, setHostDisconnected]);

  // Handle requirements result
  useEffect(() => {
    return addMessageHandler(MessageTypes.HOST_REQUIREMENTS_RESULT, (msg: Message<HostRequirementsResultPayload>) => {
      const { hostId, requirements, error } = msg.payload;
      setHostRequirementsChecking(hostId, false);
      if (!error && requirements) {
        setHostRequirements(hostId, requirements);
      }
    });
  }, [addMessageHandler, setHostRequirements, setHostRequirementsChecking]);

  // Handle process created
  useEffect(() => {
    return addMessageHandler(MessageTypes.PROCESS_CREATED, (msg: Message<ProcessCreatedPayload>) => {
      addProcess(msg.payload.process);
    });
  }, [addMessageHandler, addProcess]);

  // Handle process killed
  useEffect(() => {
    return addMessageHandler(MessageTypes.PROCESS_KILLED, (msg: Message<ProcessKilledPayload>) => {
      removeProcess(msg.payload.processId);
    });
  }, [addMessageHandler, removeProcess]);

  // Handle process updated
  useEffect(() => {
    return addMessageHandler(MessageTypes.PROCESS_UPDATED, (msg: Message<ProcessUpdatedPayload>) => {
      updateProcess(msg.payload);
    });
  }, [addMessageHandler, updateProcess]);

  // ============================================================================
  // Auto-connect on mount
  // ============================================================================

  useEffect(() => {
    if (autoConnect) {
      connect(defaultUrl);
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, defaultUrl]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: BridgeContextValue = {
    // Bridge connection
    connectionState,
    sessionId,
    reconnectToken,
    connect,
    disconnect,
    sendMessage,
    addMessageHandler,

    // Server state (read-only)
    hosts,

    // Client state
    selectedProcessId,
    selectProcess,

    // Host state mutations (for UI feedback before server response)
    setHostConnecting,
    setHostDisconnected,
    setHostError,
    setHostRequirementsChecking,
  };

  return (
    <BridgeContext.Provider value={value}>
      {children}
    </BridgeContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useBridge(): BridgeContextValue {
  const context = useContext(BridgeContext);
  if (!context) {
    throw new Error('useBridge must be used within a BridgeProvider');
  }
  return context;
}

// ============================================================================
// Specialized Hooks
// ============================================================================

/**
 * Hook to subscribe to a specific message type
 */
export function useMessageHandler<T = unknown>(
  type: MessageType,
  handler: MessageHandler<T>,
  deps: React.DependencyList = []
) {
  const { addMessageHandler } = useBridge();

  useEffect(() => {
    return addMessageHandler(type, handler as MessageHandler);
  }, [type, addMessageHandler, ...deps]);
}

/**
 * Hook to get connection status
 */
export function useConnectionState() {
  const { connectionState, sessionId, reconnectToken } = useBridge();
  return { connectionState, sessionId, reconnectToken };
}
