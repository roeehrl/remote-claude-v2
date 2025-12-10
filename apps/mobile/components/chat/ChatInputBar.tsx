import React, { useState, useCallback } from 'react';
import { StyleSheet, TextInput, Pressable, View as RNView, ActivityIndicator } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface ChatInputBarProps {
  onSend: (message: string) => void;
  onSendRaw: (data: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

type InputMode = 'text' | 'control';

// ============================================================================
// Quick Actions
// ============================================================================

const CONTROL_ACTIONS = [
  { label: 'Ctrl+C', data: '\x03', tooltip: 'Interrupt' },
  { label: 'Ctrl+D', data: '\x04', tooltip: 'EOF' },
  { label: 'Enter', data: '\n', tooltip: 'Enter' },
  { label: 'Yes', data: 'yes\n', tooltip: 'Yes' },
  { label: 'No', data: 'no\n', tooltip: 'No' },
];

// ============================================================================
// Component
// ============================================================================

export function ChatInputBar({ onSend, onSendRaw, isLoading, disabled }: ChatInputBarProps) {
  const colors = useThemeColors();
  const fontSize = useSettingsStore(selectFontSize);
  const [message, setMessage] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed && !isLoading && !disabled) {
      onSend(trimmed);
      setMessage('');
    }
  }, [message, isLoading, disabled, onSend]);

  const handleControlAction = useCallback(
    (data: string) => {
      if (!disabled) {
        onSendRaw(data);
      }
    },
    [disabled, onSendRaw]
  );

  return (
    <RNView style={[styles.container, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border }]}>
      {/* Mode Toggle */}
      <RNView style={styles.modeToggle}>
        <Pressable
          style={[
            styles.modeButton,
            {
              backgroundColor: inputMode === 'text' ? colors.primary : colors.backgroundTertiary,
            },
          ]}
          onPress={() => setInputMode('text')}
        >
          <Ionicons
            name="chatbubble"
            size={14}
            color={inputMode === 'text' ? '#fff' : colors.textSecondary}
          />
          <Text
            style={[
              styles.modeText,
              { color: inputMode === 'text' ? '#fff' : colors.textSecondary },
            ]}
          >
            Text
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.modeButton,
            {
              backgroundColor: inputMode === 'control' ? colors.primary : colors.backgroundTertiary,
            },
          ]}
          onPress={() => setInputMode('control')}
        >
          <Ionicons
            name="game-controller"
            size={14}
            color={inputMode === 'control' ? '#fff' : colors.textSecondary}
          />
          <Text
            style={[
              styles.modeText,
              { color: inputMode === 'control' ? '#fff' : colors.textSecondary },
            ]}
          >
            Control
          </Text>
        </Pressable>
      </RNView>

      {/* Input Area */}
      {inputMode === 'text' ? (
        <RNView style={styles.inputRow}>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: colors.chatInputBg,
                borderColor: colors.chatInputBorder,
                color: colors.text,
                fontSize,
              },
            ]}
            value={message}
            onChangeText={setMessage}
            placeholder="Message Claude..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={10000}
            editable={!disabled}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            style={[
              styles.sendButton,
              {
                backgroundColor: message.trim() && !isLoading && !disabled
                  ? colors.primary
                  : colors.backgroundTertiary,
              },
            ]}
            onPress={handleSend}
            disabled={!message.trim() || isLoading || disabled}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons
                name="send"
                size={18}
                color={message.trim() && !disabled ? '#fff' : colors.textMuted}
              />
            )}
          </Pressable>
        </RNView>
      ) : (
        <RNView style={styles.controlActions}>
          {CONTROL_ACTIONS.map((action, index) => (
            <Pressable
              key={index}
              style={[styles.controlButton, { backgroundColor: colors.backgroundTertiary }]}
              onPress={() => handleControlAction(action.data)}
              disabled={disabled}
            >
              <Text style={[styles.controlText, { color: disabled ? colors.textMuted : colors.text }]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </RNView>
      )}
    </RNView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    padding: 12,
  },
  modeToggle: {
    flexDirection: 'row',
    marginBottom: 10,
    gap: 8,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  modeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  controlText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
});
