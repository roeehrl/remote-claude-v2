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
  onReattach?: () => void; // Only for detached tmux sessions
}

// ============================================================================
// Component
// ============================================================================

export function StaleProcessCard({ staleProcess, onKill, onReattach }: StaleProcessCardProps) {
  const colors = useThemeColors();
  const isDetached = staleProcess.reason === 'detached' && staleProcess.tmuxSession;

  // Different styling for detached sessions (recoverable) vs stale ports (error state)
  const containerColor = isDetached ? colors.warning : colors.error;

  const getReasonText = () => {
    if (isDetached) {
      return 'Detached session';
    }
    switch (staleProcess.reason) {
      case 'connection_refused':
        return 'Connection refused';
      case 'timeout':
        return 'Connection timed out';
      default:
        return staleProcess.reason;
    }
  };

  const getTitle = () => {
    if (isDetached && staleProcess.processId) {
      // Show truncated process ID for detached sessions
      const shortId = staleProcess.processId.slice(0, 8);
      return `Session ${shortId}...`;
    }
    if (staleProcess.port) {
      return `Port ${staleProcess.port}`;
    }
    return 'Unknown';
  };

  return (
    <RNView
      style={[
        styles.container,
        {
          backgroundColor: containerColor + '10',
          borderColor: containerColor + '40',
        },
      ]}
    >
      <RNView style={styles.info}>
        <RNView style={styles.header}>
          <Ionicons
            name={isDetached ? 'pause-circle' : 'warning'}
            size={16}
            color={containerColor}
          />
          <Text style={[styles.title, { color: containerColor }]}>
            {getTitle()}
          </Text>
        </RNView>
        <Text style={[styles.reason, { color: colors.textSecondary }]}>
          {getReasonText()}
        </Text>
      </RNView>

      <RNView style={styles.actions}>
        {isDetached && onReattach && (
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={onReattach}
          >
            <Ionicons name="play" size={14} color="#fff" />
            <Text style={styles.actionText}>Reattach</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.actionButton, { backgroundColor: colors.error }]}
          onPress={onKill}
        >
          <Ionicons name="trash" size={14} color="#fff" />
          <Text style={styles.actionText}>Kill</Text>
        </Pressable>
      </RNView>
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
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  reason: {
    fontSize: 11,
    marginLeft: 22,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
