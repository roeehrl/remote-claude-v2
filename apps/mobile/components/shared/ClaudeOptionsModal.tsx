import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Pressable,
  View as RNView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';

interface ClaudeOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  onStart: (claudeArgs?: string) => void;
}

export function ClaudeOptionsModal({
  visible,
  onClose,
  onStart,
}: ClaudeOptionsModalProps) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'select' | 'custom'>('select');
  const [customArgs, setCustomArgs] = useState('');

  const handleStartDefault = () => {
    onStart();
    resetAndClose();
  };

  const handleStartContinue = () => {
    onStart('--continue');
    resetAndClose();
  };

  const handleStartCustom = () => {
    if (customArgs.trim()) {
      onStart(customArgs.trim());
      resetAndClose();
    }
  };

  const resetAndClose = () => {
    setMode('select');
    setCustomArgs('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={resetAndClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={resetAndClose} />

        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              Start Claude
            </Text>
            <Pressable style={styles.closeButton} onPress={resetAndClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </RNView>

          {mode === 'select' ? (
            <RNView style={styles.content}>
              {/* Default Option */}
              <Pressable
                style={[styles.optionButton, { backgroundColor: colors.primary }]}
                onPress={handleStartDefault}
              >
                <Ionicons name="flash" size={20} color="#fff" />
                <RNView style={styles.optionTextContainer}>
                  <Text style={styles.optionTitle}>Start New Session</Text>
                  <Text style={styles.optionDescription}>
                    Start Claude with a fresh conversation
                  </Text>
                </RNView>
              </Pressable>

              {/* Continue Option */}
              <Pressable
                style={[styles.optionButton, { backgroundColor: colors.success }]}
                onPress={handleStartContinue}
              >
                <Ionicons name="reload" size={20} color="#fff" />
                <RNView style={styles.optionTextContainer}>
                  <Text style={styles.optionTitle}>Continue Session</Text>
                  <Text style={styles.optionDescription}>
                    Resume the most recent conversation (--continue)
                  </Text>
                </RNView>
              </Pressable>

              {/* Custom Option */}
              <Pressable
                style={[styles.optionButton, { backgroundColor: colors.warning }]}
                onPress={() => setMode('custom')}
              >
                <Ionicons name="code-slash" size={20} color="#fff" />
                <RNView style={styles.optionTextContainer}>
                  <Text style={styles.optionTitle}>Custom Arguments</Text>
                  <Text style={styles.optionDescription}>
                    Specify custom Claude CLI arguments
                  </Text>
                </RNView>
              </Pressable>
            </RNView>
          ) : (
            <RNView style={styles.content}>
              {/* Custom Args Input */}
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Claude Arguments
              </Text>
              <Text style={[styles.helperText, { color: colors.textMuted }]}>
                Arguments to append to the claude command (e.g., --continue, -s, -p "prompt")
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                value={customArgs}
                onChangeText={setCustomArgs}
                placeholder="--continue"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />

              {/* Buttons */}
              <RNView style={styles.customButtons}>
                <Pressable
                  style={[styles.customButton, { backgroundColor: colors.backgroundTertiary }]}
                  onPress={() => setMode('select')}
                >
                  <Text style={[styles.customButtonText, { color: colors.text }]}>Back</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.customButton,
                    { backgroundColor: customArgs.trim() ? colors.primary : colors.border },
                  ]}
                  onPress={handleStartCustom}
                  disabled={!customArgs.trim()}
                >
                  <Text style={styles.customButtonText}>Start Claude</Text>
                </Pressable>
              </RNView>
            </RNView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionDescription: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontFamily: 'SpaceMono',
  },
  customButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  customButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  customButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
