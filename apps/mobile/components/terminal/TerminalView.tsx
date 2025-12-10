import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  View,
  ListRenderItem,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/Themed';
import { TerminalLine } from './TerminalLine';
import { useTheme, useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler } from '@/providers/BridgeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import { AnsiParser, ParsedLine } from '@/lib/ansi';
import {
  Message,
  Messages,
  MessageTypes,
  PtyOutputPayload,
  PtyHistoryResponsePayload,
  PtyHistoryChunkPayload,
  PtyHistoryCompletePayload,
} from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

interface TerminalViewProps {
  processId: string;
  onReady?: () => void;
}

interface LineData {
  key: string;
  parsed: ParsedLine;
}

// ============================================================================
// Component
// ============================================================================

export function TerminalView({ processId, onReady }: TerminalViewProps) {
  const flatListRef = useRef<FlatList<LineData>>(null);
  const parserRef = useRef<AnsiParser | null>(null);
  const lastLineCountRef = useRef(0);
  const initialScrollDone = useRef(false);
  const loadingProcessIdRef = useRef<string | null>(null);

  // LOCAL STATE - no global store, component is completely stateless
  const [rawOutput, setRawOutput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const chunksRef = useRef<string[]>([]);

  const { isDarkMode } = useTheme();
  const colors = useThemeColors();
  const fontSize = useSettingsStore(selectFontSize);
  const { sendMessage } = useBridge();

  // Derive lines from raw output
  const bufferLines = useMemo(() => {
    if (!rawOutput) return [];
    return rawOutput.split('\n');
  }, [rawOutput]);

  // ============================================================================
  // Request history on mount / process change
  // ============================================================================

  useEffect(() => {
    parserRef.current = new AnsiParser(isDarkMode);

    // Reset local state for new process
    setRawOutput('');
    setHistoryLoaded(false);
    chunksRef.current = [];
    initialScrollDone.current = false;
    lastLineCountRef.current = 0;

    // Request history from bridge
    if (loadingProcessIdRef.current !== processId) {
      loadingProcessIdRef.current = processId;
      setIsLoadingHistory(true);
      sendMessage(Messages.ptyHistoryRequest({ processId }));
    }

    onReady?.();
  }, [processId, sendMessage]);

  // Update parser dark mode
  useEffect(() => {
    if (parserRef.current) {
      parserRef.current.setDarkMode(isDarkMode);
    }
  }, [isDarkMode]);

  // ============================================================================
  // Parse lines for rendering
  // ============================================================================

  const parsedLines = useMemo((): LineData[] => {
    if (!parserRef.current) {
      parserRef.current = new AnsiParser(isDarkMode);
    }

    // Reset parser for consistent parsing
    parserRef.current.reset();

    return bufferLines.map((line, index) => ({
      key: `${processId}-${index}`,
      parsed: parserRef.current!.parseLine(line),
    }));
  }, [bufferLines, processId, isDarkMode]);

  // ============================================================================
  // Auto-scroll to bottom on mount and when new lines arrive
  // ============================================================================

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    // Use requestAnimationFrame to ensure scroll happens after render
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  // Initial scroll to bottom
  useEffect(() => {
    if (parsedLines.length > 0 && !initialScrollDone.current) {
      // Delay initial scroll to ensure FlatList is ready
      setTimeout(() => {
        scrollToBottom();
        initialScrollDone.current = true;
      }, 150);
    }
  }, [parsedLines.length, scrollToBottom]);

  // Scroll when new lines added
  useEffect(() => {
    if (parsedLines.length > lastLineCountRef.current && parsedLines.length > 0) {
      // New lines added, scroll to bottom after render
      scrollToBottom();
    }
    lastLineCountRef.current = parsedLines.length;
  }, [parsedLines.length, scrollToBottom]);

  // Also scroll after content size changes
  const handleContentSizeChange = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

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
        // Decode base64 chunk and store
        try {
          const decoded = atob(msg.payload.data);
          chunksRef.current.push(decoded);

          // Progressive rendering: update display as chunks arrive
          setRawOutput(chunksRef.current.join(''));
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
      if (msg.payload.processId === processId) {
        setIsLoadingHistory(false);
        setHistoryLoaded(true);

        if (!msg.payload.success) {
          console.error('PTY history load failed:', msg.payload.error);
        }
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Handle live PTY output (appends to local state)
  // ============================================================================

  useMessageHandler<PtyOutputPayload>(
    MessageTypes.PTY_OUTPUT,
    useCallback((msg: Message<PtyOutputPayload>) => {
      if (msg.payload.processId === processId) {
        // Append to local state (not global store)
        setRawOutput(prev => prev + msg.payload.data);
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // Render item
  // ============================================================================

  const renderItem: ListRenderItem<LineData> = useCallback(
    ({ item, index }) => (
      <TerminalLine line={item.parsed} lineNumber={index} />
    ),
    []
  );

  const keyExtractor = useCallback((item: LineData) => item.key, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<LineData> | null | undefined, index: number) => ({
      length: fontSize * 1.3 + 2, // Approximate line height
      offset: (fontSize * 1.3 + 2) * index,
      index,
    }),
    [fontSize]
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.terminalBg }]}>
      {/* Terminal output */}
      <FlatList
        ref={flatListRef}
        data={parsedLines}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        style={styles.flatList}
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: 0 }}
        showsVerticalScrollIndicator={true}
        removeClippedSubviews={false}
        maxToRenderPerBatch={50}
        windowSize={21}
        initialNumToRender={30}
        onContentSizeChange={handleContentSizeChange}
        onScrollToIndexFailed={() => {
          // Ignore scroll failures
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            {isLoadingHistory ? (
              <>
                <ActivityIndicator size="small" color={colors.terminalText} />
                <Text style={[styles.emptyText, { color: colors.terminalText, marginTop: 8 }]}>
                  Loading terminal history...
                </Text>
              </>
            ) : (
              <Text style={[styles.emptyText, { color: colors.terminalText }]}>
                Terminal connected. Waiting for output...
              </Text>
            )}
          </View>
        }
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
    overflow: 'hidden', // Prevent content from overflowing into input bar
  },
  flatList: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 16, // Extra padding at bottom for better readability above input bar
  },
  emptyContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    opacity: 0.5,
  },
});
