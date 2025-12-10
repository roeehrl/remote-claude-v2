import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  FlatList,
  View,
  ListRenderItem,
} from 'react-native';
import { Text } from '@/components/Themed';
import { TerminalLine } from './TerminalLine';
import { useTheme, useThemeColors } from '@/providers/ThemeProvider';
import { useMessageHandler } from '@/providers/BridgeProvider';
import { useTerminalStore, useSettingsStore, selectFontSize, selectBufferLines } from '@/stores';
import { AnsiParser, ParsedLine } from '@/lib/ansi';
import {
  Message,
  MessageTypes,
  PtyOutputPayload,
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
  const clearedRef = useRef<string | null>(null);

  const { isDarkMode } = useTheme();
  const colors = useThemeColors();
  const fontSize = useSettingsStore(selectFontSize);

  const appendOutput = useTerminalStore(state => state.appendOutput);
  const clearBuffer = useTerminalStore(state => state.clearBuffer);

  // Memoize the selector to avoid creating new function references
  const bufferLinesSelector = useMemo(() => selectBufferLines(processId), [processId]);
  const bufferLines = useTerminalStore(bufferLinesSelector);

  // ============================================================================
  // Initialize parser and clear buffer on mount (once per processId)
  // ============================================================================

  useEffect(() => {
    parserRef.current = new AnsiParser(isDarkMode);
    // Clear any stale buffer data on mount to start fresh (only once per processId)
    if (clearedRef.current !== processId) {
      clearedRef.current = processId;
      clearBuffer(processId);
    }
    onReady?.();
  }, [processId]);

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
  // Handle PTY output
  // ============================================================================

  useMessageHandler<PtyOutputPayload>(
    MessageTypes.PTY_OUTPUT,
    useCallback((msg: Message<PtyOutputPayload>) => {
      if (msg.payload.processId === processId) {
        appendOutput(processId, msg.payload.data);
      }
    }, [processId, appendOutput]),
    [processId, appendOutput]
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
            <Text style={[styles.emptyText, { color: colors.terminalText }]}>
              Terminal connected. Waiting for output...
            </Text>
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
