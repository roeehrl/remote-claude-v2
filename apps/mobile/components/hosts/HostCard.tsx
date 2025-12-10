import React, { useState } from 'react';
import { StyleSheet, Pressable, View as RNView, ActivityIndicator } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { SSHHost } from '@/stores/settingsStore';
import { ConnectedHost, HostConnectionState } from '@/stores/hostStore';
import { ProcessInfo, StaleProcess } from '@remote-claude/shared-types';
import { ProcessCard } from './ProcessCard';
import { StaleProcessCard } from './StaleProcessCard';
import { RequirementsBanner } from './RequirementsBanner';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface HostCardProps {
  host: SSHHost;
  connectedHost?: ConnectedHost;
  selectedProcessId: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onNewShell: () => void;
  onSelectProcess: (processId: string) => void;
  onStartClaude: (processId: string) => void;
  onKillClaude: (processId: string) => void;
  onKillProcess: (processId: string) => void;
  onKillStaleProcess: (port: number) => void;
  onRefreshRequirements: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function HostCard({
  host,
  connectedHost,
  selectedProcessId,
  onConnect,
  onDisconnect,
  onNewShell,
  onSelectProcess,
  onStartClaude,
  onKillClaude,
  onKillProcess,
  onKillStaleProcess,
  onRefreshRequirements,
}: HostCardProps) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(true);

  const state = connectedHost?.state ?? 'disconnected';
  const processes = connectedHost?.processes ?? [];
  const staleProcesses = connectedHost?.staleProcesses ?? [];
  const requirements = connectedHost?.requirements;
  const requirementsChecking = connectedHost?.requirementsChecking ?? false;
  const isConnected = state === 'connected';
  const isConnecting = state === 'connecting';

  // Check if Claude features are available (both claude and agentapi installed)
  const canStartClaude = requirements?.claudeInstalled && requirements?.agentApiInstalled;

  const getStateColor = () => {
    switch (state) {
      case 'connected':
        return colors.statusConnected;
      case 'connecting':
        return colors.statusConnecting;
      case 'error':
        return colors.statusDisconnected;
      default:
        return colors.textSecondary;
    }
  };

  const getStateText = () => {
    switch (state) {
      case 'connected':
        return `Connected (${processes.length} process${processes.length !== 1 ? 'es' : ''})`;
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return connectedHost?.error ?? 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <RNView style={styles.headerLeft}>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={18}
            color={colors.textSecondary}
          />
          <RNView style={styles.hostInfo}>
            <Text style={[styles.hostName, { color: colors.text }]}>{host.name}</Text>
            <Text style={[styles.hostAddress, { color: colors.textSecondary }]}>
              {host.username}@{host.host}:{host.port}
            </Text>
          </RNView>
        </RNView>

        <RNView style={styles.headerRight}>
          <RNView style={styles.stateContainer}>
            {isConnecting ? (
              <ActivityIndicator size="small" color={colors.statusConnecting} />
            ) : (
              <RNView style={[styles.stateDot, { backgroundColor: getStateColor() }]} />
            )}
            <Text style={[styles.stateText, { color: getStateColor() }]} numberOfLines={1}>
              {getStateText()}
            </Text>
          </RNView>
        </RNView>
      </Pressable>

      {/* Expanded Content */}
      {expanded && (
        <RNView style={styles.content}>
          {/* Requirements Banner - show when connected but missing requirements */}
          {isConnected && (
            <RequirementsBanner
              hostId={host.id}
              requirements={requirements}
              isChecking={requirementsChecking}
              onRefresh={onRefreshRequirements}
            />
          )}

          {/* Connection Controls */}
          <RNView style={styles.controls}>
            {!isConnected && !isConnecting && (
              <Pressable
                style={[styles.controlButton, { backgroundColor: colors.primary }]}
                onPress={onConnect}
              >
                <Ionicons name="power" size={16} color="#fff" />
                <Text style={styles.controlButtonText}>Connect</Text>
              </Pressable>
            )}

            {isConnected && (
              <>
                <Pressable
                  style={[styles.controlButton, { backgroundColor: colors.primary }]}
                  onPress={onNewShell}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.controlButtonText}>New Shell</Text>
                </Pressable>

                <Pressable
                  style={[styles.controlButton, { backgroundColor: colors.error }]}
                  onPress={onDisconnect}
                >
                  <Ionicons name="power" size={16} color="#fff" />
                  <Text style={styles.controlButtonText}>Disconnect</Text>
                </Pressable>
              </>
            )}

            {isConnecting && (
              <Pressable
                style={[styles.controlButton, { backgroundColor: colors.error }]}
                onPress={onDisconnect}
              >
                <Ionicons name="close" size={16} color="#fff" />
                <Text style={styles.controlButtonText}>Cancel</Text>
              </Pressable>
            )}
          </RNView>

          {/* Process List */}
          {isConnected && processes.length > 0 && (
            <RNView style={styles.processList}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                Active Processes
              </Text>
              {processes.map(process => (
                <ProcessCard
                  key={process.id}
                  process={process}
                  isSelected={selectedProcessId === process.id}
                  canStartClaude={canStartClaude}
                  onSelect={() => onSelectProcess(process.id)}
                  onStartClaude={() => onStartClaude(process.id)}
                  onKillClaude={() => onKillClaude(process.id)}
                  onKill={() => onKillProcess(process.id)}
                />
              ))}
            </RNView>
          )}

          {/* Stale Processes */}
          {isConnected && staleProcesses.length > 0 && (
            <RNView style={styles.staleList}>
              <Text style={[styles.sectionTitle, { color: colors.error }]}>
                Stale Processes (need cleanup)
              </Text>
              {staleProcesses.map(stale => (
                <StaleProcessCard
                  key={stale.port}
                  staleProcess={stale}
                  onKill={() => onKillStaleProcess(stale.port)}
                />
              ))}
            </RNView>
          )}

          {/* Empty State */}
          {isConnected && processes.length === 0 && staleProcesses.length === 0 && (
            <RNView style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No active processes. Tap "New Shell" to create one.
              </Text>
            </RNView>
          )}
        </RNView>
      )}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  hostInfo: {
    flex: 1,
  },
  hostName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  hostAddress: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  headerRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
    maxWidth: '40%',
  },
  stateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateText: {
    fontSize: 12,
    fontWeight: '500',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  processList: {
    marginTop: 4,
  },
  staleList: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  emptyState: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
