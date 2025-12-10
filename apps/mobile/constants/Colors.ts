/**
 * Color palettes for Remote Claude V2
 *
 * Designed for terminal/chat interfaces with good contrast and readability.
 */

// Brand colors
const brandPrimary = '#6366f1'; // Indigo - Claude-like
const brandSecondary = '#8b5cf6'; // Purple

// Light theme
export const lightTheme = {
  // Core colors
  text: '#1f2937',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  background: '#ffffff',
  backgroundSecondary: '#f9fafb',
  backgroundTertiary: '#f3f4f6',

  // Brand
  primary: brandPrimary,
  primaryLight: '#818cf8',
  primaryDark: '#4f46e5',
  secondary: brandSecondary,

  // UI elements
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  divider: '#e5e7eb',
  card: '#ffffff',
  cardElevated: '#ffffff',

  // Status colors
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  // Terminal colors
  terminalBg: '#1e1e1e',
  terminalText: '#d4d4d4',
  terminalCursor: '#ffffff',

  // Chat
  chatUserBubble: brandPrimary,
  chatUserText: '#ffffff',
  chatAssistantBubble: '#f3f4f6',
  chatAssistantText: '#1f2937',
  chatInputBg: '#ffffff',
  chatInputBorder: '#e5e7eb',

  // Navigation
  tabIconDefault: '#9ca3af',
  tabIconSelected: brandPrimary,
  navBackground: '#ffffff',

  // Connection status
  statusConnected: '#10b981',
  statusDisconnected: '#ef4444',
  statusConnecting: '#f59e0b',
};

// Dark theme
export const darkTheme = {
  // Core colors
  text: '#f9fafb',
  textSecondary: '#d1d5db',
  textMuted: '#9ca3af',
  background: '#111827',
  backgroundSecondary: '#1f2937',
  backgroundTertiary: '#374151',

  // Brand
  primary: '#818cf8', // Lighter indigo for dark mode
  primaryLight: '#a5b4fc',
  primaryDark: '#6366f1',
  secondary: '#a78bfa',

  // UI elements
  border: '#374151',
  borderLight: '#4b5563',
  divider: '#374151',
  card: '#1f2937',
  cardElevated: '#374151',

  // Status colors
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#60a5fa',

  // Terminal colors
  terminalBg: '#0d1117',
  terminalText: '#e6edf3',
  terminalCursor: '#ffffff',

  // Chat
  chatUserBubble: '#6366f1',
  chatUserText: '#ffffff',
  chatAssistantBubble: '#374151',
  chatAssistantText: '#f9fafb',
  chatInputBg: '#1f2937',
  chatInputBorder: '#374151',

  // Navigation
  tabIconDefault: '#6b7280',
  tabIconSelected: '#818cf8',
  navBackground: '#111827',

  // Connection status
  statusConnected: '#34d399',
  statusDisconnected: '#f87171',
  statusConnecting: '#fbbf24',
};

export type Theme = typeof lightTheme;

// Default export for backwards compatibility
export default {
  light: lightTheme,
  dark: darkTheme,
};
