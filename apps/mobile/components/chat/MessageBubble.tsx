import React from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { ChatMessage } from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

interface MessageBubbleProps {
  message: ChatMessage;
}

// ============================================================================
// Component
// ============================================================================

export function MessageBubble({ message }: MessageBubbleProps) {
  const colors = useThemeColors();
  const isUser = message.role === 'user';

  const formatTime = (isoTime: string) => {
    const date = new Date(isoTime);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <RNView style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <RNView
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: colors.chatUserBubble }
            : { backgroundColor: colors.chatAssistantBubble },
        ]}
      >
        <Text
          style={[
            styles.messageText,
            { color: isUser ? colors.chatUserText : colors.chatAssistantText },
          ]}
          selectable
        >
          {message.message}
        </Text>
      </RNView>
      <Text style={[styles.time, { color: colors.textMuted }]}>
        {formatTime(message.time)}
      </Text>
    </RNView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 12,
    maxWidth: '85%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  time: {
    fontSize: 10,
    marginTop: 4,
    marginHorizontal: 4,
  },
});
