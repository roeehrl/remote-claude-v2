/**
 * Remote Claude V2 - Shared Types
 *
 * This package contains all WebSocket protocol types shared between
 * the mobile app (TypeScript) and the Bridge service (Go).
 *
 * IMPORTANT: These types must stay in sync with the Go definitions in
 * services/bridge/internal/protocol/. Protocol alignment tests verify this.
 */

// Export all message types and creators
export * from './messages';

// Export configuration types
export * from './config';
