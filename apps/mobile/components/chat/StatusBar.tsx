import React from 'react';
import { StyleSheet, View as RNView, ActivityIndicator } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { AgentStatus } from '@/stores/chatStore';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface StatusBarProps {
  status: AgentStatus;
  agentType?: string;
  processId: string;
  isClaude: boolean;
  shellPid?: number;
  agentApiPid?: number;
}

// ============================================================================
// Component
// ============================================================================

export function StatusBar({ status, agentType, processId, isClaude, shellPid, agentApiPid }: StatusBarProps) {
  const colors = useThemeColors();

  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return colors.statusConnecting;
      case 'stable':
        return colors.statusConnected;
      default:
        return colors.statusDisconnected;
    }
  };

  const getStatusIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (status) {
      case 'running':
        return 'sync';
      case 'stable':
        return 'checkmark-circle';
      default:
        return 'close-circle';
    }
  };

  const getStatusText = () => {
    if (!isClaude) return 'Shell (not Claude)';
    switch (status) {
      case 'running':
        return 'Processing...';
      case 'stable':
        return 'Ready';
      default:
        return 'Disconnected';
    }
  };

  return (
    <RNView style={[styles.container, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
      <RNView style={styles.left}>
        {status === 'running' ? (
          <ActivityIndicator size="small" color={getStatusColor()} />
        ) : (
          <Ionicons name={getStatusIcon()} size={16} color={getStatusColor()} />
        )}
        <Text style={[styles.statusText, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>
      </RNView>

      <RNView style={styles.right}>
        {agentType && (
          <Text style={[styles.agentType, { color: colors.textSecondary }]}>
            {agentType}
          </Text>
        )}
        <RNView style={styles.pidInfo}>
          {shellPid && (
            <Text style={[styles.pidText, { color: colors.textMuted }]}>
              PID: {shellPid}
            </Text>
          )}
          {agentApiPid && (
            <Text style={[styles.pidText, { color: colors.textMuted }]}>
              API: {agentApiPid}
            </Text>
          )}
        </RNView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentType: {
    fontSize: 12,
    fontWeight: '500',
  },
  pidInfo: {
    flexDirection: 'row',
    gap: 8,
  },
  pidText: {
    fontSize: 11,
    fontFamily: 'SpaceMono',
  },
});
