import React, { useRef, useCallback } from 'react';
import { useTheme } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler } from '@/providers/BridgeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import {
  Message,
  Messages,
  MessageTypes,
  PtyOutputPayload,
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

  const { isDarkMode } = useTheme();
  const { sendMessage } = useBridge();
  const fontSize = useSettingsStore(selectFontSize);

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
  // Handle ready callback
  // ============================================================================

  const handleReady = useCallback(async () => {
    onReady?.();
  }, [onReady]);

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
