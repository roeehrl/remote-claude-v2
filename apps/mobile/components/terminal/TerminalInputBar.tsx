import React, { useState, useCallback } from 'react';
import { StyleSheet, Pressable, View as RNView, TextInput, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge } from '@/providers/BridgeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import { Messages } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface TerminalInputBarProps {
  processId: string;
}

interface QuickAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  data: string;
  tooltip: string;
}

// ============================================================================
// Quick Actions Config
// ============================================================================

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Ctrl+C', data: '\x03', tooltip: 'Interrupt' },
  { label: 'Ctrl+D', data: '\x04', tooltip: 'EOF' },
  { label: 'Ctrl+Z', data: '\x1a', tooltip: 'Suspend' },
  { label: 'Esc', data: '\x1b', tooltip: 'Escape' },
  { label: 'Tab', data: '\t', tooltip: 'Tab/Autocomplete' },
  { label: '\u2191', icon: 'arrow-up', data: '\x1b[A', tooltip: 'Up Arrow' },
  { label: '\u2193', icon: 'arrow-down', data: '\x1b[B', tooltip: 'Down Arrow' },
  { label: '\u2190', icon: 'arrow-back', data: '\x1b[D', tooltip: 'Left Arrow' },
  { label: '\u2192', icon: 'arrow-forward', data: '\x1b[C', tooltip: 'Right Arrow' },
];

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

  const handleAction = useCallback((action: QuickAction) => {
    sendInput(action.data);
  }, [sendInput]);

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
          style={[styles.sendButton, { backgroundColor: inputText ? colors.primary : colors.backgroundTertiary }]}
          onPress={handleSubmit}
        >
          <Ionicons
            name="return-down-back"
            size={18}
            color={inputText ? '#fff' : colors.textMuted}
          />
        </Pressable>
      </RNView>

      {/* Quick actions row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actions}
      >
        {QUICK_ACTIONS.map((action, index) => (
          <Pressable
            key={index}
            style={[styles.actionButton, { backgroundColor: colors.backgroundTertiary }]}
            onPress={() => handleAction(action)}
            accessibilityLabel={action.tooltip}
          >
            {action.icon ? (
              <Ionicons name={action.icon} size={16} color={colors.text} />
            ) : (
              <Text style={[styles.actionText, { color: colors.text }]}>{action.label}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
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
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
});
