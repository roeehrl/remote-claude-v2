import React, { useState, useCallback } from 'react';
import { StyleSheet, Pressable, View as RNView, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge } from '@/providers/BridgeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import { Messages } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';
import { ActionBar } from '@/components/shared';

// ============================================================================
// Types
// ============================================================================

interface TerminalInputBarProps {
  processId: string;
}

// ============================================================================
// Component
// ============================================================================

export function TerminalInputBar({ processId }: TerminalInputBarProps) {
  const colors = useThemeColors();
  const { sendMessage } = useBridge();
  const fontSize = useSettingsStore(selectFontSize);
  const [inputText, setInputText] = useState('');
  const insets = useSafeAreaInsets();

  // Add bottom safe area padding on native (for home indicator)
  const bottomPadding = Platform.OS !== 'web' ? Math.max(insets.bottom, 8) : 8;

  const sendInput = useCallback((data: string) => {
    sendMessage(Messages.ptyInput({ processId, data }));
  }, [processId, sendMessage]);

  const handleSubmit = useCallback(() => {
    if (inputText) {
      sendInput(inputText + '\r');
      setInputText('');
    } else {
      // Just send enter if empty
      sendInput('\r');
    }
  }, [inputText, sendInput]);

  return (
    <RNView style={[styles.container, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border, paddingBottom: bottomPadding }]}>
      {/* Command input row */}
      <RNView style={styles.inputRow}>
        <Text style={[styles.prompt, { color: colors.primary }]}>$</Text>
        <TextInput
          style={[styles.textInput, { color: colors.terminalText, fontSize }]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type command..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          blurOnSubmit={false}
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: inputText ? colors.primary : colors.backgroundTertiary,
              opacity: pressed ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
          onPress={handleSubmit}
        >
          <Ionicons
            name="return-down-back"
            size={18}
            color={inputText ? '#fff' : colors.textMuted}
          />
        </Pressable>
      </RNView>

      {/* Shared action bar */}
      <ActionBar context="terminal" onSendData={sendInput} />
    </RNView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 12,
    gap: 8,
    flexShrink: 0, // Never shrink - always show full input bar
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prompt: {
    fontFamily: 'SpaceMono',
    fontSize: 14,
    fontWeight: '700',
  },
  textInput: {
    flex: 1,
    fontFamily: 'SpaceMono',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
