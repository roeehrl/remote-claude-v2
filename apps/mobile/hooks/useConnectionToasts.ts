import { useEffect, useRef } from 'react';
import { useConnectionState } from '@/providers/BridgeProvider';
import { useToastStore } from '@/stores';
import { ConnectionState } from '@/providers/BridgeProvider';

/**
 * Hook that shows toast notifications for connection state changes
 */
export function useConnectionToasts() {
  const { connectionState } = useConnectionState();
  const prevStateRef = useRef<ConnectionState | null>(null);

  // Get stable references to toast functions using getState()
  const toastStore = useToastStore;

  useEffect(() => {
    const prevState = prevStateRef.current;
    prevStateRef.current = connectionState;

    // Skip initial mount
    if (prevState === null) {
      return;
    }

    // Only show toast if state actually changed
    if (prevState === connectionState) {
      return;
    }

    // Get functions from store state to avoid dependency issues
    const { success, error, warning } = toastStore.getState();

    switch (connectionState) {
      case 'connected':
        if (prevState === 'reconnecting') {
          success('Reconnected', 'Connection restored to Bridge');
        } else {
          success('Connected', 'Connected to Bridge');
        }
        break;

      case 'disconnected':
        if (prevState !== 'disconnected') {
          error('Disconnected', 'Lost connection to Bridge');
        }
        break;

      case 'reconnecting':
        warning('Reconnecting', 'Attempting to reconnect to Bridge...');
        break;

      case 'connecting':
        // Don't show toast for connecting - too noisy
        break;
    }
  }, [connectionState]);
}
