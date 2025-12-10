import React from 'react';
import { StyleSheet, Pressable, View as RNView } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { StaleProcess } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface StaleProcessCardProps {
  staleProcess: StaleProcess;
  onKill: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function StaleProcessCard({ staleProcess, onKill }: StaleProcessCardProps) {
  const colors = useThemeColors();

  return (
    <RNView
      style={[
        styles.container,
        {
          backgroundColor: colors.error + '10',
          borderColor: colors.error + '40',
        },
      ]}
    >
      <RNView style={styles.info}>
        <RNView style={styles.header}>
          <Ionicons name="warning" size={16} color={colors.error} />
          <Text style={[styles.port, { color: colors.error }]}>
            Port {staleProcess.port}
          </Text>
        </RNView>
        <Text style={[styles.reason, { color: colors.textSecondary }]}>
          {staleProcess.reason === 'connection_refused'
            ? 'Connection refused'
            : staleProcess.reason === 'timeout'
            ? 'Connection timed out'
            : staleProcess.reason}
        </Text>
      </RNView>

      <Pressable
        style={[styles.killButton, { backgroundColor: colors.error }]}
        onPress={onKill}
      >
        <Ionicons name="trash" size={14} color="#fff" />
        <Text style={styles.killText}>Kill</Text>
      </Pressable>
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
    justifyContent: 'space-between',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 6,
  },
  info: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  port: {
    fontSize: 13,
    fontWeight: '600',
  },
  reason: {
    fontSize: 11,
    marginLeft: 22,
  },
  killButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  killText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
