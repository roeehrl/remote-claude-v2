import React, { useRef, useCallback, useEffect } from 'react';
import { useTheme } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler } from '@/providers/BridgeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import {
  Message,
  Messages,
  MessageTypes,
  PtyOutputPayload,
  PtyHistoryResponsePayload,
  PtyHistoryChunkPayload,
  PtyHistoryCompletePayload,
} from '@remote-claude/shared-types';
import TerminalXterm from './TerminalXterm';

// ============================================================================
// Types
// ============================================================================

interface TerminalViewProps {
  processId: string;
  onReady?: () => void;
}

// ============================================================================
// Component - Native version using xterm.js DOM component
// ============================================================================

// Interface for the xterm ref exposed via useDOMImperativeHandle
interface XtermRef {
  write: (data: string) => void;
  clear: () => void;
}

export function TerminalView({ processId, onReady }: TerminalViewProps) {
  const xtermRef = useRef<XtermRef>(null);
  const loadingProcessIdRef = useRef<string | null>(null);
  const chunksRef = useRef<string[]>([]);
  const terminalReadyRef = useRef(false);

  const { isDarkMode } = useTheme();
  const { sendMessage } = useBridge();
  const fontSize = useSettingsStore(selectFontSize);

  // ============================================================================
  // Handle process change - clear terminal and request history
  // ============================================================================

  useEffect(() => {
    // Clear terminal for new process (if terminal is already initialized)
    if (terminalReadyRef.current) {
      xtermRef.current?.clear();

      // Reset state for new process
      chunksRef.current = [];
      loadingProcessIdRef.current = processId;

      // Request history from bridge (terminal is ready)
      sendMessage(Messages.ptyHistoryRequest({ processId }));
    }
  }, [processId, sendMessage]);

  // ============================================================================
  // Handle user input from xterm
  // ============================================================================

  const handleData = useCallback(async (data: string) => {
    // Filter out terminal query responses that shouldn't be sent to the PTY
    // These are responses to escape sequences like DA1 (ESC[c), DA2 (ESC[>c),
    // and OSC color queries. When sent to bash, they get echoed as garbage text.

    // Skip DA1 responses: ESC[?...c (e.g., ESC[?1;2c)
    if (data.match(/^\x1b\[\?[\d;]*c$/)) {
      return;
    }
    // Skip DA2 responses: ESC[>...c (e.g., ESC[>0;276;0c)
    if (data.match(/^\x1b\[>[\d;]*c$/)) {
      return;
    }
    // Skip OSC responses: ESC]...\\ or ESC]...BEL (color queries, etc.)
    if (data.match(/^\x1b\][\d;]*[^\x07\x1b]*[\x07\x1b\\]?$/)) {
      return;
    }
    // Skip DSR responses: ESC[...n or ESC[...R (cursor position, etc.)
    if (data.match(/^\x1b\[\d+;\d+R$/)) {
      return;
    }

    sendMessage(Messages.ptyInput({ processId, data }));
  }, [processId, sendMessage]);

  // ============================================================================
  // Handle ready callback - request history when terminal is first ready
  // ============================================================================

  const handleReady = useCallback(async () => {
    terminalReadyRef.current = true;

    // Request history for initial process (terminal just became ready)
    if (loadingProcessIdRef.current !== processId) {
      loadingProcessIdRef.current = processId;
      chunksRef.current = [];
      sendMessage(Messages.ptyHistoryRequest({ processId }));
    }

    onReady?.();
  }, [processId, sendMessage, onReady]);

  // ============================================================================
  // Handle PTY history response (metadata)
  // ============================================================================

  useMessageHandler<PtyHistoryResponsePayload>(
    MessageTypes.PTY_HISTORY_RESPONSE,
    useCallback((msg: Message<PtyHistoryResponsePayload>) => {
      if (msg.payload.processId === processId) {
        // Reset chunks for new history load
        chunksRef.current = [];
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Handle PTY history chunks
  // ============================================================================

  useMessageHandler<PtyHistoryChunkPayload>(
    MessageTypes.PTY_HISTORY_CHUNK,
    useCallback((msg: Message<PtyHistoryChunkPayload>) => {
      if (msg.payload.processId === processId) {
        // Decode base64 chunk and write to terminal
        try {
          const decoded = atob(msg.payload.data);
          chunksRef.current.push(decoded);
          // Progressive rendering: write to terminal as chunks arrive
          xtermRef.current?.write(decoded);
        } catch (err) {
          console.error('Failed to decode PTY history chunk:', err);
        }
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Handle PTY history complete
  // ============================================================================

  useMessageHandler<PtyHistoryCompletePayload>(
    MessageTypes.PTY_HISTORY_COMPLETE,
    useCallback((msg: Message<PtyHistoryCompletePayload>) => {
      if (msg.payload.processId === processId && !msg.payload.success) {
        console.error('PTY history load failed:', msg.payload.error);
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Handle PTY output - write to xterm via ref
  // ============================================================================

  useMessageHandler<PtyOutputPayload>(
    MessageTypes.PTY_OUTPUT,
    useCallback((msg: Message<PtyOutputPayload>) => {
      if (msg.payload.processId === processId) {
        xtermRef.current?.write(msg.payload.data);
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Render
  // ============================================================================

  // Get the terminal background color to pass to DOM component
  const terminalBgColor = isDarkMode ? '#0d1117' : '#ffffff';

  return (
    <TerminalXterm
      ref={xtermRef}
      isDarkMode={isDarkMode}
      fontSize={fontSize}
      onData={handleData}
      onReady={handleReady}
      dom={{
        // Make the webview fill the container
        scrollEnabled: false, // xterm handles its own scrolling
        style: { flex: 1, backgroundColor: terminalBgColor },
        containerStyle: { flex: 1, backgroundColor: terminalBgColor },
      }}
    />
  );
}
