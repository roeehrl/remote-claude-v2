'use dom';

import React, { useEffect, useRef, Ref } from 'react';
import { useDOMImperativeHandle } from 'expo/dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// ============================================================================
// Types
// ============================================================================

// Using any for the ref type to avoid DOMImperativeFactory type constraints
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TerminalXtermRef = any;

interface TerminalXtermProps {
  ref?: Ref<TerminalXtermRef>;
  dom?: import('expo/dom').DOMProps;
  isDarkMode: boolean;
  fontSize: number;
  onData: (data: string) => Promise<void>;
  onReady: () => Promise<void>;
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

export default function TerminalXterm({
  ref,
  isDarkMode,
  fontSize,
  onData,
  onReady,
}: TerminalXtermProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Expose write and clear methods via DOM imperative handle (for native side)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useDOMImperativeHandle as any)(
    ref,
    () => ({
      write: (data: string) => {
        if (terminalRef.current) {
          terminalRef.current.write(data);
        }
      },
      clear: () => {
        if (terminalRef.current) {
          terminalRef.current.clear();
        }
      },
    }),
    []
  );

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Inject CSS reset to ensure body/html fill the viewport
    const style = document.createElement('style');
    style.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
    `;
    document.head.appendChild(style);

    const terminal = new Terminal({
      theme: isDarkMode ? darkTerminalTheme : lightTerminalTheme,
      fontSize,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    // Handle user input - send to native side
    terminal.onData((data) => {
      onData(data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    resizeObserver.observe(containerRef.current);

    // Notify ready
    onReady();

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      // Clean up injected style
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    };
  }, []);

  // Update theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = isDarkMode ? darkTerminalTheme : lightTerminalTheme;
    }
  }, [isDarkMode]);

  // Update font size when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  return (
    <div
      ref={containerRef}
      style={{
        // Use absolute positioning to fill the container
        // Note: Don't use 100vw/100vh - in React Native WebViews, viewport units
        // can include safe area insets and behave differently than on web
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: isDarkMode ? darkTerminalTheme.background : lightTerminalTheme.background,
        overflow: 'hidden',
      }}
    />
  );
}
