import React, { useRef, useEffect, useCallback } from 'react';
import { StyleSheet, FlatList, View as RNView, ListRenderItem } from 'react-native';
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
}

// ============================================================================
// Component
// ============================================================================

export function MessageList({ messages, isLoading }: MessageListProps) {
  const colors = useThemeColors();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const lastMessageCountRef = useRef(0);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      // New message added, scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
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
      maintainVisibleContentPosition={{
        minIndexForVisible: 0,
        autoscrollToTopThreshold: 100,
      }}
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
