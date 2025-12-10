import React, { useEffect, useRef, useCallback, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useTheme, useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler } from '@/providers/BridgeProvider';
import { useTerminalStore, useSettingsStore, selectFontSize } from '@/stores';
import {
  Message,
  Messages,
  MessageTypes,
  PtyOutputPayload,
} from '@remote-claude/shared-types';

// Dynamic imports for xterm (client-side only)
type Terminal = import('@xterm/xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;
type WebLinksAddon = import('@xterm/addon-web-links').WebLinksAddon;

// ============================================================================
// Types
// ============================================================================

interface TerminalViewProps {
  processId: string;
  onReady?: () => void;
}

// ============================================================================
// Theme configs for xterm
// ============================================================================

const lightTerminalTheme = {
  background: '#ffffff',
  foreground: '#1f2937',
  cursor: '#1f2937',
  cursorAccent: '#ffffff',
  selectionBackground: '#6366f140',
  selectionForeground: '#1f2937',
  black: '#1f2937',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f3f4f6',
  brightBlack: '#4b5563',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

const darkTerminalTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  cursorAccent: '#0d1117',
  selectionBackground: '#818cf840',
  selectionForeground: '#e6edf3',
  black: '#1f2937',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#f9fafb',
  brightBlack: '#6b7280',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

// ============================================================================
// Component
// ============================================================================

export function TerminalView({ processId, onReady }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { isDarkMode } = useTheme();
  const colors = useThemeColors();
  const { sendMessage } = useBridge();
  const fontSize = useSettingsStore(selectFontSize);

  const { appendOutput, getBuffer } = useTerminalStore();

  // ============================================================================
  // Initialize terminal (with dynamic imports)
  // ============================================================================

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    const initTerminal = async () => {
      try {
        // Dynamically import xterm modules (client-side only)
        const [
          { Terminal },
          { FitAddon },
          { WebLinksAddon },
        ] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links'),
        ]);

        // Import CSS
        await import('@xterm/xterm/css/xterm.css');

        if (!mounted || !containerRef.current) return;

        // Clean up existing terminal
        if (terminalRef.current) {
          terminalRef.current.dispose();
        }

        // Create terminal with theme
        const terminal = new Terminal({
          fontFamily: '"SpaceMono", "Menlo", "Monaco", "Courier New", monospace',
          fontSize,
          cursorBlink: true,
          cursorStyle: 'block',
          theme: isDarkMode ? darkTerminalTheme : lightTerminalTheme,
          scrollback: 10000,
          // Note: allowProposedApi disabled to prevent terminal query responses
          // from being echoed as text in the shell
        });

        // Add addons
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        const webLinksAddon = new WebLinksAddon();
        terminal.loadAddon(webLinksAddon);

        // Open in container
        terminal.open(containerRef.current);

        // Store refs first so they're available
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // Handle user input
        // Filter out terminal query responses that shouldn't be sent to the PTY
        // These are responses to escape sequences like DA1 (ESC[c), DA2 (ESC[>c),
        // and OSC color queries. When sent to bash, they get echoed as garbage text.
        terminal.onData((data: string) => {
          // Skip DA1 responses: ESC[?...c (e.g., ESC[?1;2c)
          if (data.match(/^\x1b\[\?[\d;]*c$/)) {
            return;
          }
          // Skip DA2 responses: ESC[>...c (e.g., ESC[>0;276;0c)
          if (data.match(/^\x1b\[>[\d;]*c$/)) {
            return;
          }
          // Skip OSC responses: ESC]...\ or ESC]...BEL (color queries, etc.)
          if (data.match(/^\x1b\][\d;]*[^\x07\x1b]*[\x07\x1b\\]?$/)) {
            return;
          }
          // Skip DSR responses: ESC[...n or ESC[...R (cursor position, etc.)
          if (data.match(/^\x1b\[\d+;\d+R$/)) {
            return;
          }
          sendMessage(Messages.ptyInput({ processId, data }));
        });

        // Handle resize - register BEFORE fit so initial size is captured
        terminal.onResize(({ cols, rows }) => {
          sendMessage(Messages.ptyResize({ processId, cols, rows }));
        });

        // Now fit the terminal - this will trigger onResize with correct dimensions
        fitAddon.fit();

        // Also send an explicit resize in case onResize didn't fire
        // (some xterm versions don't fire onResize on initial fit)
        const { cols, rows } = terminal;
        if (cols && rows) {
          sendMessage(Messages.ptyResize({ processId, cols, rows }));
        }

        // Replay buffer if exists
        const buffer = getBuffer(processId);
        if (buffer && buffer.rawOutput) {
          terminal.write(buffer.rawOutput);
        }

        setIsLoading(false);

        // Notify ready
        onReady?.();

        // Handle window resize
        const handleResize = () => {
          if (fitAddonRef.current && terminalRef.current) {
            fitAddonRef.current.fit();
          }
        };
        window.addEventListener('resize', handleResize);

        // Also observe container size changes (for layout changes, not just window resize)
        let resizeObserver: ResizeObserver | null = null;
        if (containerRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            // Debounce the fit call slightly to avoid rapid resizes
            requestAnimationFrame(() => {
              if (fitAddonRef.current && terminalRef.current) {
                fitAddonRef.current.fit();
              }
            });
          });
          resizeObserver.observe(containerRef.current);
        }

        // Store cleanup function
        return () => {
          window.removeEventListener('resize', handleResize);
          if (resizeObserver) {
            resizeObserver.disconnect();
          }
        };
      } catch (err) {
        console.error('Failed to load terminal:', err);
        if (mounted) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load terminal');
          setIsLoading(false);
        }
      }
    };

    initTerminal();

    return () => {
      mounted = false;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [processId]); // Reinitialize when process changes

  // ============================================================================
  // Update theme when it changes
  // ============================================================================

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = isDarkMode ? darkTerminalTheme : lightTerminalTheme;
    }
  }, [isDarkMode]);

  // ============================================================================
  // Update font size when it changes
  // ============================================================================

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  // ============================================================================
  // Handle PTY output
  // ============================================================================

  useMessageHandler<PtyOutputPayload>(
    MessageTypes.PTY_OUTPUT,
    useCallback((msg: Message<PtyOutputPayload>) => {
      if (msg.payload.processId === processId) {
        const data = msg.payload.data;
        // Write to terminal
        terminalRef.current?.write(data);
        // Store in buffer for replay
        appendOutput(processId, data);
      }
    }, [processId, appendOutput]),
    [processId, appendOutput]
  );

  // ============================================================================
  // Focus terminal
  // ============================================================================

  const handleContainerClick = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (loadError) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ color: colors.error }}>Failed to load terminal: {loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={[styles.loadingOverlay, { backgroundColor: isDarkMode ? darkTerminalTheme.background : lightTerminalTheme.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Loading terminal...</Text>
        </View>
      )}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: isDarkMode ? darkTerminalTheme.background : lightTerminalTheme.background,
        }}
      />
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative', // Ensure proper containment for absolute children
    minHeight: 0, // Allow flex item to shrink below content size
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
});
