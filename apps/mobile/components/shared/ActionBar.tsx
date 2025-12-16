import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Pressable, View as RNView, TextInput, ScrollView, Platform, Keyboard } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

export type ActionBarContext = 'terminal' | 'chat';

interface ActionBarProps {
  context: ActionBarContext;
  onSendData: (data: string) => void;
  disabled?: boolean;
}

interface QuickAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  data: string;
  tooltip: string;
  contexts: ActionBarContext[]; // Which contexts this action appears in
}

// ============================================================================
// Helper: Convert key to Ctrl character
// ============================================================================

function keyToCtrlChar(key: string): string | null {
  // Ctrl+A through Ctrl+Z map to ASCII 1-26
  const upper = key.toUpperCase();
  if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
    const charCode = upper.charCodeAt(0) - 64; // A=1, B=2, ..., Z=26
    return String.fromCharCode(charCode);
  }
  return null;
}

// ============================================================================
// Quick Actions Config
// ============================================================================

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Ctrl+C', data: '\x03', tooltip: 'Interrupt', contexts: ['terminal'] },
  { label: 'Ctrl+D', data: '\x04', tooltip: 'EOF', contexts: ['terminal'] },
  { label: 'Ctrl+Z', data: '\x1a', tooltip: 'Suspend', contexts: ['terminal'] },
  { label: 'Esc', data: '\x1b', tooltip: 'Escape', contexts: ['terminal', 'chat'] },
  { label: 'Tab', data: '\t', tooltip: 'Tab/Autocomplete', contexts: ['terminal', 'chat'] },
  { label: '\u2191', icon: 'arrow-up', data: '\x1b[A', tooltip: 'Up Arrow', contexts: ['terminal', 'chat'] },
  { label: '\u2193', icon: 'arrow-down', data: '\x1b[B', tooltip: 'Down Arrow', contexts: ['terminal', 'chat'] },
  { label: '\u2190', icon: 'arrow-back', data: '\x1b[D', tooltip: 'Left Arrow', contexts: ['terminal', 'chat'] },
  { label: '\u2192', icon: 'arrow-forward', data: '\x1b[C', tooltip: 'Right Arrow', contexts: ['terminal', 'chat'] },
];

// Enter action - rendered separately on the right for chat context
const ENTER_ACTION: QuickAction = { label: 'Enter', icon: 'return-down-back', data: '\r', tooltip: 'Enter', contexts: ['chat'] };

// ============================================================================
// Component
// ============================================================================

export function ActionBar({ context, onSendData, disabled }: ActionBarProps) {
  const colors = useThemeColors();
  const [ctrlMode, setCtrlMode] = useState(false);
  const ctrlInputRef = useRef<TextInput>(null);

  // Filter actions based on context
  const visibleActions = QUICK_ACTIONS.filter(action => action.contexts.includes(context));

  // Handle Ctrl+key input
  const handleCtrlKeyInput = useCallback((text: string) => {
    if (text.length > 0) {
      const lastChar = text[text.length - 1];
      const ctrlChar = keyToCtrlChar(lastChar);
      if (ctrlChar) {
        onSendData(ctrlChar);
      }
      setCtrlMode(false);
    }
  }, [onSendData]);

  // Web keyboard listener for Ctrl mode
  useEffect(() => {
    if (!ctrlMode || Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.length === 1) {
        const ctrlChar = keyToCtrlChar(e.key);
        if (ctrlChar) {
          e.preventDefault();
          onSendData(ctrlChar);
          setCtrlMode(false);
        }
      } else if (e.key === 'Escape') {
        setCtrlMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ctrlMode, onSendData]);

  // Focus hidden input when entering Ctrl mode (works on native and mobile web)
  useEffect(() => {
    if (ctrlMode && ctrlInputRef.current) {
      // Small delay to ensure the component is mounted and ready
      const timer = setTimeout(() => {
        ctrlInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [ctrlMode]);

  const handleAction = useCallback((action: QuickAction) => {
    if (!disabled) {
      onSendData(action.data);
    }
  }, [disabled, onSendData]);

  const toggleCtrlMode = useCallback(() => {
    setCtrlMode(prev => !prev);
  }, []);

  const showEnter = context === 'chat';

  return (
    <RNView style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actions}
        style={styles.scrollView}
      >
        {/* Ctrl button - toggles ctrl mode */}
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.ctrlButton,
            {
              backgroundColor: ctrlMode ? colors.primary : colors.backgroundTertiary,
              borderColor: ctrlMode ? colors.primary : 'transparent',
              opacity: pressed ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
          onPress={toggleCtrlMode}
          disabled={disabled}
          accessibilityLabel="Ctrl modifier - press then type a key"
        >
          <Text style={[styles.actionText, { color: ctrlMode ? '#fff' : (disabled ? colors.textMuted : colors.text) }]}>
            {ctrlMode ? 'Ctrl+?' : 'Ctrl'}
          </Text>
        </Pressable>

        {visibleActions.map((action, index) => (
          <Pressable
            key={index}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.backgroundTertiary,
                opacity: pressed ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              },
            ]}
            onPress={() => handleAction(action)}
            disabled={disabled}
            accessibilityLabel={action.tooltip}
          >
            {action.icon ? (
              <Ionicons name={action.icon} size={16} color={disabled ? colors.textMuted : colors.text} />
            ) : (
              <Text style={[styles.actionText, { color: disabled ? colors.textMuted : colors.text }]}>
                {action.label}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>

      {/* Enter button on the right for chat context */}
      {showEnter && (
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: colors.backgroundTertiary,
              opacity: pressed ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
          onPress={() => handleAction(ENTER_ACTION)}
          disabled={disabled}
          accessibilityLabel={ENTER_ACTION.tooltip}
        >
          <Ionicons name="return-down-back" size={16} color={disabled ? colors.textMuted : colors.text} />
        </Pressable>
      )}

      {/* Hidden input for capturing Ctrl+key on native and mobile web */}
      {ctrlMode && (
        <TextInput
          ref={ctrlInputRef}
          style={styles.hiddenInput}
          autoFocus
          showSoftInputOnFocus={true}
          onChangeText={handleCtrlKeyInput}
          onBlur={() => setCtrlMode(false)}
          maxLength={1}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
        />
      )}
    </RNView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scrollView: {
    flex: 1,
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
  ctrlButton: {
    borderWidth: 1,
  },
  hiddenInput: {
    position: 'absolute',
    // Use minimal size instead of 0 - some devices won't show keyboard for 0-sized inputs
    width: 1,
    height: 1,
    // Position off-screen so it's not visible
    top: -100,
    left: -100,
    // Make it invisible
    opacity: 0,
  },
});
