import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import { StyleSheet, FlatList, View as RNView, ListRenderItem, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { ChatMessage } from '@remote-claude/shared-types';
import { MessageBubble } from './MessageBubble';

// ============================================================================
// Types
// ============================================================================

interface MessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  onScrollAwayFromBottom?: (isAway: boolean) => void;
}

export interface MessageListRef {
  scrollToEnd: (animated?: boolean) => void;
}

// Threshold in pixels to consider "at bottom"
const SCROLL_THRESHOLD = 50;

// ============================================================================
// Component
// ============================================================================

export const MessageList = forwardRef<MessageListRef, MessageListProps>(
  function MessageList({ messages, isLoading, onScrollAwayFromBottom }, ref) {
    const colors = useThemeColors();
    const flatListRef = useRef<FlatList<ChatMessage>>(null);
    const lastMessageCountRef = useRef(0);
    const isAtBottomRef = useRef(true);
    const contentHeightRef = useRef(0);
    const scrollOffsetRef = useRef(0);
    const layoutHeightRef = useRef(0);

    // Expose scrollToEnd method via ref
    useImperativeHandle(ref, () => ({
      scrollToEnd: (animated = true) => {
        // Use scrollToIndex to scroll to the last item
        // This works reliably with virtualized FlatLists because FlatList
        // knows the index even if the item isn't currently rendered
        if (messages.length > 0) {
          flatListRef.current?.scrollToIndex({
            index: messages.length - 1,
            animated,
            viewPosition: 1, // Position at bottom of viewport
          });
        }
        // Immediately update state since we're scrolling to bottom
        isAtBottomRef.current = true;
        onScrollAwayFromBottom?.(false);
      },
    }), [onScrollAwayFromBottom, messages.length]);

    // Check if user is at bottom of list
    const checkIfAtBottom = useCallback(() => {
      const maxScroll = contentHeightRef.current - layoutHeightRef.current;
      const isAtBottom = maxScroll <= 0 || scrollOffsetRef.current >= maxScroll - SCROLL_THRESHOLD;

      if (isAtBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = isAtBottom;
        onScrollAwayFromBottom?.(!isAtBottom);
      }
    }, [onScrollAwayFromBottom]);

    // Handle scroll events
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      checkIfAtBottom();
    }, [checkIfAtBottom]);

    // Handle content size changes
    const handleContentSizeChange = useCallback((width: number, height: number) => {
      contentHeightRef.current = height;
      checkIfAtBottom();
    }, [checkIfAtBottom]);

    // Handle layout changes
    const handleLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
      layoutHeightRef.current = event.nativeEvent.layout.height;
      checkIfAtBottom();
    }, [checkIfAtBottom]);

    // Auto-scroll when new messages arrive (only if already at bottom)
    useEffect(() => {
      if (messages.length > lastMessageCountRef.current && isAtBottomRef.current) {
        // New message added and we're at bottom, scroll to bottom
        // Use a short delay to allow content size to update
        setTimeout(() => {
          const maxOffset = Math.max(0, contentHeightRef.current - layoutHeightRef.current);
          flatListRef.current?.scrollToOffset({ offset: maxOffset, animated: true });
        }, 100);
      }
      lastMessageCountRef.current = messages.length;
    }, [messages.length]);

    const renderItem: ListRenderItem<ChatMessage> = useCallback(
      ({ item }) => <MessageBubble message={item} />,
      []
    );

    const keyExtractor = useCallback(
      (item: ChatMessage) => `${item.id}`,
      []
    );

    // Handle scroll-to-index failures (can happen with virtualized lists)
    const handleScrollToIndexFailed = useCallback((info: {
      index: number;
      highestMeasuredFrameIndex: number;
      averageItemLength: number;
    }) => {
      // Scroll to estimated position first, then retry after a short delay
      const offset = info.averageItemLength * info.index;
      flatListRef.current?.scrollToOffset({ offset, animated: false });

      // Retry scrollToIndex after content has a chance to render
      setTimeout(() => {
        if (flatListRef.current && messages.length > 0) {
          flatListRef.current.scrollToIndex({
            index: messages.length - 1,
            animated: true,
            viewPosition: 1,
          });
        }
      }, 100);
    }, [messages.length]);

    if (messages.length === 0) {
      return (
        <RNView style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No messages yet. Start a conversation with Claude.
          </Text>
        </RNView>
      );
    }

    return (
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        scrollEventThrottle={16}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        ListFooterComponent={
          isLoading ? (
            <RNView style={styles.loadingContainer}>
              <RNView style={[styles.typingIndicator, { backgroundColor: colors.chatAssistantBubble }]}>
                <Text style={[styles.typingText, { color: colors.textSecondary }]}>
                  Claude is thinking...
                </Text>
              </RNView>
            </RNView>
          ) : null
        }
      />
    );
  }
);

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loadingContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typingIndicator: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  typingText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
});
