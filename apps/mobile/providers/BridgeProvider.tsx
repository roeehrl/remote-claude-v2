import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  Message,
  MessageType,
  MessageTypes,
  Messages,
  AuthResultPayload,
} from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type MessageHandler<T = unknown> = (message: Message<T>) => void;

interface BridgeContextValue {
  // Connection state
  connectionState: ConnectionState;
  sessionId: string | null;
  reconnectToken: string | null;

  // Connection control
  connect: (url: string) => void;
  disconnect: () => void;

  // Messaging
  sendMessage: <T>(message: Message<T>) => void;
  addMessageHandler: (type: MessageType, handler: MessageHandler) => () => void;
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
  defaultUrl = 'ws://localhost:8080/ws',
}: BridgeProviderProps) {
  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reconnectToken, setReconnectToken] = useState<string | null>(null);

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
    connectionState,
    sessionId,
    reconnectToken,
    connect,
    disconnect,
    sendMessage,
    addMessageHandler,
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
