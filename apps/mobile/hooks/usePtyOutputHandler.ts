import { useCallback } from 'react';
import { useMessageHandler } from '@/providers/BridgeProvider';
import { useTerminalStore } from '@/stores';
import {
  Message,
  MessageTypes,
  PtyOutputPayload,
} from '@remote-claude/shared-types';

interface UsePtyOutputHandlerOptions {
  /** Whether the handler is enabled. Default: true */
  enabled?: boolean;
}

/**
 * Global hook that captures all PTY output and stores it in the terminal buffer.
 * This should be mounted at the root of the app to ensure PTY output is captured
 * even when the terminal tab is not active.
 *
 * On native platforms, this should be disabled since TerminalView handles its own
 * PTY output to avoid double-appending.
 */
export function usePtyOutputHandler(options: UsePtyOutputHandlerOptions = {}) {
  const { enabled = true } = options;
  const appendOutput = useTerminalStore(state => state.appendOutput);

  useMessageHandler<PtyOutputPayload>(
    MessageTypes.PTY_OUTPUT,
    useCallback((msg: Message<PtyOutputPayload>) => {
      if (!enabled) return;
      const { processId, data } = msg.payload;
      // Store output in buffer for later replay
      appendOutput(processId, data);
    }, [appendOutput, enabled]),
    [appendOutput, enabled]
  );
}
