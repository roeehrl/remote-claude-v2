// Platform-specific exports:
// - TerminalView.native.tsx is used on iOS/Android (uses xterm.js via DOM component)
// - TerminalView.web.tsx is used on web (uses xterm.js directly)
// - TerminalView.tsx is the fallback (FlatList-based, not used anymore)
export { TerminalView } from './TerminalView';
export { TerminalInputBar } from './TerminalInputBar';
