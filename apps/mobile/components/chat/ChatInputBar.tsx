import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, TextInput, Pressable, View as RNView, ActivityIndicator, Platform, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';
import { Ionicons } from '@expo/vector-icons';
import { ActionBar } from '@/components/shared';

// ============================================================================
// Types
// ============================================================================

interface ChatInputBarProps {
  onSend: (message: string) => void;
  onSendPty: (data: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
  // Voice input props
  isListening?: boolean;
  interimTranscript?: string;
  speechRecognitionAvailable?: boolean;
  onStartListening?: () => void;
  onStopListening?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ChatInputBar({
  onSend,
  onSendPty,
  isLoading,
  disabled,
  isListening,
  interimTranscript,
  speechRecognitionAvailable,
  onStartListening,
  onStopListening,
}: ChatInputBarProps) {
  const colors = useThemeColors();
  const fontSize = useSettingsStore(selectFontSize);
  const [message, setMessage] = useState('');
  const insets = useSafeAreaInsets();

  // Pulse animation for listening state
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isListening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isListening, pulseAnim]);

  // Add bottom safe area padding on native (for home indicator)
  const bottomPadding = Platform.OS !== 'web' ? Math.max(insets.bottom, 8) : 8;

  // Display text: show interim transcript while listening, otherwise show typed message
  const displayText = isListening && interimTranscript ? interimTranscript : message;
  const placeholderText = isListening ? 'Listening...' : 'Message Claude...';

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed && !isLoading && !disabled) {
      onSend(trimmed);
      setMessage('');
    }
  }, [message, isLoading, disabled, onSend]);

  const handleMicPress = useCallback(() => {
    if (isListening) {
      onStopListening?.();
    } else {
      onStartListening?.();
    }
  }, [isListening, onStartListening, onStopListening]);

  const showMicButton = speechRecognitionAvailable && Platform.OS !== 'web';

  return (
    <RNView style={[styles.container, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border, paddingBottom: bottomPadding }]}>
      {/* Chat message input row */}
      <RNView style={styles.inputRow}>
        {/* Microphone button */}
        {showMicButton && (
          <Animated.View style={{ transform: [{ scale: isListening ? pulseAnim : 1 }] }}>
            <Pressable
              style={({ pressed }) => [
                styles.micButton,
                {
                  backgroundColor: isListening ? colors.error : colors.backgroundTertiary,
                  opacity: pressed ? 0.5 : 1,
                },
              ]}
              onPress={handleMicPress}
              disabled={disabled || isLoading}
            >
              <Ionicons
                name={isListening ? 'stop' : 'mic'}
                size={20}
                color={isListening ? '#fff' : colors.text}
              />
            </Pressable>
          </Animated.View>
        )}

        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.chatInputBg,
              borderColor: isListening ? colors.error : colors.chatInputBorder,
              color: colors.text,
              fontSize,
            },
          ]}
          value={displayText}
          onChangeText={setMessage}
          placeholder={placeholderText}
          placeholderTextColor={isListening ? colors.error : colors.textMuted}
          multiline
          maxLength={10000}
          editable={!disabled && !isListening}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: message.trim() && !isLoading && !disabled
                ? colors.primary
                : colors.backgroundTertiary,
              opacity: pressed ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
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

      {/* Shared action bar */}
      <ActionBar context="chat" onSendData={onSendPty} disabled={disabled} />
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
    flexShrink: 0,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
});
