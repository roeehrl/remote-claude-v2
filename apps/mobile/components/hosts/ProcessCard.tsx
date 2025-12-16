import React from 'react';
import { StyleSheet, Pressable, View as RNView, Text as RNText } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { ProcessInfo } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface ProcessCardProps {
  process: ProcessInfo;
  isSelected: boolean;
  canStartClaude?: boolean; // Whether Claude/AgentAPI are installed on host
  onSelect: () => void;
  onStartClaude: () => void;
  onStartClaudeLongPress?: () => void; // Long press to show options modal
  onKillClaude: () => void;
  onKill: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ProcessCard({
  process,
  isSelected,
  canStartClaude = true,
  onSelect,
  onStartClaude,
  onStartClaudeLongPress,
  onKillClaude,
  onKill,
}: ProcessCardProps) {
  const colors = useThemeColors();
  const isClaude = process.type === 'claude';

  const getStatusColor = () => {
    if (!process.ptyReady) return colors.warning;
    if (isClaude && process.agentApiReady) return colors.success;
    if (isClaude && !process.agentApiReady) return colors.warning;
    return colors.success;
  };

  const getStatusText = () => {
    if (!process.ptyReady) return 'Starting...';
    if (isClaude && process.agentApiReady) return 'Ready';
    if (isClaude && !process.agentApiReady) return 'Claude starting...';
    return 'Ready';
  };

  const formatTime = (isoTime: string) => {
    const date = new Date(isoTime);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Pressable
      style={[
        styles.container,
        {
          backgroundColor: isSelected ? colors.primary + '20' : colors.card,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
      onPress={onSelect}
    >
      {/* Header Row */}
      <RNView style={styles.header}>
        <RNView style={styles.typeContainer}>
          <Ionicons
            name={isClaude ? 'chatbubble-ellipses' : 'terminal'}
            size={18}
            color={isClaude ? colors.chatUserBubble : colors.terminalText}
          />
          <Text style={[styles.type, { color: colors.textSecondary }]}>
            {process.name || (isClaude ? 'Claude' : 'Shell')}
          </Text>
        </RNView>
        <RNView style={styles.statusContainer}>
          <RNView style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {getStatusText()}
          </Text>
        </RNView>
      </RNView>

      {/* Process ID */}
      <Text style={[styles.processId, { color: colors.textSecondary }]} numberOfLines={1}>
        ID: {process.id}
      </Text>

      {/* Info Row */}
      <RNView style={styles.infoRow}>
        <Text style={[styles.cwd, { color: colors.text }]} numberOfLines={1}>
          {process.cwd || '~'}
        </Text>
        <Text style={[styles.time, { color: colors.textSecondary }]}>
          {formatTime(process.startedAt)}
        </Text>
      </RNView>

      {/* Process Details */}
      <RNView style={styles.detailsRow}>
        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
          Shell PID: {process.shellPid ?? '—'}
        </Text>
        {isClaude && (
          <>
            <Text style={[styles.detailText, { color: colors.textSecondary }]}>
              AgentAPI PID: {process.agentApiPid ?? '—'}
            </Text>
            <Text style={[styles.detailText, { color: colors.textSecondary }]}>
              Port: {process.port ?? '—'}
            </Text>
          </>
        )}
      </RNView>

      {/* Action Buttons */}
      <RNView style={styles.actions}>
        {!isClaude && process.ptyReady && canStartClaude && (
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={onStartClaude}
            onLongPress={onStartClaudeLongPress}
            delayLongPress={500}
          >
            <RNView style={styles.actionButtonContent} pointerEvents="none">
              <Ionicons name="flash" size={14} color="#fff" />
              <RNText style={styles.actionText}>Claude</RNText>
            </RNView>
          </Pressable>
        )}

        {isClaude && (
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.warning }]}
            onPress={onKillClaude}
          >
            <Ionicons name="flash-off" size={14} color="#fff" />
            <Text style={styles.actionText}>Revert</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.actionButton, { backgroundColor: colors.error }]}
          onPress={onKill}
        >
          <Ionicons name="close-circle" size={14} color="#fff" />
          <Text style={styles.actionText}>Kill</Text>
        </Pressable>
      </RNView>
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  type: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  processId: {
    fontSize: 10,
    fontFamily: 'SpaceMono',
    marginBottom: 4,
  },
  cwd: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 11,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
