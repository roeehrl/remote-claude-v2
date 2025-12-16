import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { StyleSheet, ScrollView, View as RNView, RefreshControl, View, Pressable } from 'react-native';
import { Text } from '@/components/Themed';
import { HostCard, EnvVarsModal, PortsModal } from '@/components/hosts';
import { ClaudeOptionsModal } from '@/components/shared';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useConnectionState } from '@/providers/BridgeProvider';
import { useSettingsStore, useToastStore, selectBridgeUrl, selectBridgeAutoConnect } from '@/stores';
import { Messages, MessageTypes, Message, EnvVar, PortInfo, PortsResultPayload, SSHHostConfig } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Hosts Screen
// ============================================================================

export default function HostsScreen() {
  const colors = useThemeColors();
  const {
    sendMessage,
    connect: connectBridge,
    disconnect: disconnectBridge,
    configuredHosts,
    configuredHostsLoading,
    refreshHosts,
    hosts: hostsMap,
    selectedProcessId,
    selectProcess,
    setHostConnecting,
    setHostDisconnected,
    setHostError,
    setHostRequirementsChecking,
    setHostEnvLoading,
    addMessageHandler,
  } = useBridge();
  const { connectionState } = useConnectionState();
  const [refreshing, setRefreshing] = React.useState(false);

  // Env modal state
  const [envModalHostId, setEnvModalHostId] = useState<string | null>(null);

  // Ports modal state
  const [portsModalHostId, setPortsModalHostId] = useState<string | null>(null);
  const [portsData, setPortsData] = useState<{
    ports: PortInfo[];
    netTool?: string;
    netToolError?: string;
    loading: boolean;
    error?: string;
  }>({ ports: [], loading: false });

  // Claude options modal state
  const [claudeOptionsProcessId, setClaudeOptionsProcessId] = useState<string | null>(null);

  // Settings store (bridge URL only)
  const bridgeUrl = useSettingsStore(selectBridgeUrl);
  const bridgeAutoConnect = useSettingsStore(selectBridgeAutoConnect);

  // Toast store
  const { success, error: showError, info } = useToastStore();

  // Derive connected hosts from Map
  const connectedHosts = useMemo(() => Array.from(hostsMap.values()), [hostsMap]);

  // ============================================================================
  // Auto-connect hosts on Bridge reconnect
  // ============================================================================

  const prevConnectionStateRef = useRef(connectionState);
  const autoConnectingRef = useRef(false);

  useEffect(() => {
    const wasConnected = prevConnectionStateRef.current === 'connected';
    const isNowConnected = connectionState === 'connected';
    prevConnectionStateRef.current = connectionState;

    // When Bridge reconnects (was not connected, now is connected)
    if (!wasConnected && isNowConnected && !autoConnectingRef.current) {
      // Find hosts with autoConnect enabled that aren't already connected
      const autoConnectHosts = configuredHosts.filter(h =>
        h.autoConnect && !hostsMap.has(h.id)
      );

      if (autoConnectHosts.length > 0) {
        autoConnectingRef.current = true;

        // Auto-connect each host (credentials stored in bridge)
        autoConnectHosts.forEach(host => {
          setHostConnecting(host.id);
          sendMessage(Messages.hostConnect({ hostId: host.id }));
        });

        autoConnectingRef.current = false;
      }
    }
  }, [connectionState, configuredHosts, hostsMap, setHostConnecting, sendMessage]);

  // ============================================================================
  // Actions
  // ============================================================================

  const handleConnect = useCallback((hostId: string) => {
    setHostConnecting(hostId);
    // Credentials are stored in bridge - just send hostId
    sendMessage(Messages.hostConnect({ hostId }));
  }, [setHostConnecting, sendMessage]);

  const handleDisconnect = useCallback((hostId: string) => {
    sendMessage(Messages.hostDisconnect({ hostId }));
    setHostDisconnected(hostId);
  }, [sendMessage, setHostDisconnected]);

  const handleNewShell = useCallback((hostId: string) => {
    sendMessage(Messages.processCreate({ hostId }));
  }, [sendMessage]);

  const handleSelectProcess = useCallback((processId: string) => {
    selectProcess(processId);
    sendMessage(Messages.processSelect({ processId }));
  }, [selectProcess, sendMessage]);

  const handleStartClaude = useCallback((processId: string, claudeArgs?: string) => {
    sendMessage(Messages.claudeStart({ processId, claudeArgs }));
  }, [sendMessage]);

  const handleStartClaudeLongPress = useCallback((processId: string) => {
    setClaudeOptionsProcessId(processId);
  }, []);

  const handleClaudeOptionsClose = useCallback(() => {
    setClaudeOptionsProcessId(null);
  }, []);

  const handleClaudeOptionsStart = useCallback((claudeArgs?: string) => {
    console.log('[DEBUG] ClaudeOptionsStart - claudeArgs:', claudeArgs, 'processId:', claudeOptionsProcessId);
    if (claudeOptionsProcessId) {
      handleStartClaude(claudeOptionsProcessId, claudeArgs);
    }
    setClaudeOptionsProcessId(null);
  }, [claudeOptionsProcessId, handleStartClaude]);

  const handleKillClaude = useCallback((processId: string) => {
    sendMessage(Messages.claudeKill({ processId }));
  }, [sendMessage]);

  const handleKillProcess = useCallback((processId: string) => {
    sendMessage(Messages.processKill({ processId }));
  }, [sendMessage]);

  const handleKillStaleProcess = useCallback((hostId: string, stale: { port?: number; tmuxSession?: string }) => {
    // TODO: Implement stale process killing via tmux kill-session
    // For now, just log - proper implementation needs bridge support
    if (stale.tmuxSession) {
      console.log('Kill detached tmux session:', hostId, stale.tmuxSession);
      // Future: sendMessage(Messages.killTmuxSession({ hostId, tmuxSession: stale.tmuxSession }));
    } else if (stale.port) {
      console.log('Kill stale AgentAPI port:', hostId, stale.port);
      // This would need to find and kill the process using the port
    }
    info('Killing stale processes is not yet implemented');
  }, [info]);

  const handleReattachStaleProcess = useCallback((hostId: string, stale: { tmuxSession?: string; processId?: string }) => {
    if (!stale.tmuxSession || !stale.processId) {
      showError('Cannot reattach: missing session info');
      return;
    }
    sendMessage(Messages.processReattach({
      hostId,
      tmuxSession: stale.tmuxSession,
      processId: stale.processId,
    }));
    info('Reattaching to session...');
  }, [sendMessage, info, showError]);

  const handleRefreshRequirements = useCallback((hostId: string) => {
    setHostRequirementsChecking(hostId, true);
    sendMessage(Messages.hostCheckRequirements({ hostId }));
  }, [sendMessage, setHostRequirementsChecking]);

  // ============================================================================
  // Env Var Handlers
  // ============================================================================

  const handleOpenEnvVars = useCallback((hostId: string) => {
    setEnvModalHostId(hostId);
    setHostEnvLoading(hostId, true);
    sendMessage(Messages.envList({ hostId }));
  }, [sendMessage, setHostEnvLoading]);

  const handleCloseEnvVars = useCallback(() => {
    setEnvModalHostId(null);
  }, []);

  const handleSaveEnvVars = useCallback((hostId: string, vars: EnvVar[]) => {
    setHostEnvLoading(hostId, true);
    sendMessage(Messages.envUpdate({ hostId, customVars: vars }));
  }, [sendMessage, setHostEnvLoading]);

  const handleChangeRcFile = useCallback((hostId: string, rcFile: string) => {
    setHostEnvLoading(hostId, true);
    sendMessage(Messages.envSetRcFile({ hostId, rcFile }));
  }, [sendMessage, setHostEnvLoading]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // Refresh connected hosts by requesting process list
    connectedHosts.forEach(ch => {
      if (ch.state === 'connected') {
        sendMessage(Messages.processList({ hostId: ch.id }));
      }
    });
    setTimeout(() => setRefreshing(false), 1000);
  }, [connectedHosts, sendMessage]);

  // ============================================================================
  // Ports Scanning Handlers
  // ============================================================================

  const handleOpenPorts = useCallback((hostId: string) => {
    setPortsModalHostId(hostId);
    setPortsData({ ports: [], loading: true });
    sendMessage(Messages.portsScan({ hostId }));
  }, [sendMessage]);

  const handleClosePorts = useCallback(() => {
    setPortsModalHostId(null);
    setPortsData({ ports: [], loading: false });
  }, []);

  const handleRefreshPorts = useCallback(() => {
    if (!portsModalHostId) return;
    setPortsData(prev => ({ ...prev, loading: true, error: undefined }));
    sendMessage(Messages.portsScan({ hostId: portsModalHostId }));
  }, [portsModalHostId, sendMessage]);

  // Handle PORTS_RESULT messages
  useEffect(() => {
    const handler = (msg: Message<PortsResultPayload>) => {
      const { hostId, ports, netTool, netToolError, error } = msg.payload;
      // Only update if this is for the currently open modal
      if (hostId === portsModalHostId) {
        setPortsData({
          ports: ports ?? [],
          netTool: netTool ?? undefined,
          netToolError: netToolError ?? undefined,
          loading: false,
          error: error ?? undefined,
        });
      }
    };
    return addMessageHandler(MessageTypes.PORTS_RESULT, handler as (msg: Message) => void);
  }, [addMessageHandler, portsModalHostId]);

  // ============================================================================
  // Render
  // ============================================================================

  const getConnectedHost = (hostId: string) => hostsMap.get(hostId);

  const isDisconnected = connectionState === 'disconnected';
  const isConnected = connectionState === 'connected';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Connection Status Banner */}
      {isDisconnected && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusDisconnected + '20' }]}>
          <RNView style={styles.bannerContent}>
            <Ionicons name="cloud-offline" size={18} color={colors.statusDisconnected} />
            <Text style={[styles.bannerText, { color: colors.statusDisconnected }]}>
              Not connected to Bridge
            </Text>
          </RNView>
          <Pressable
            style={[styles.bannerButton, { backgroundColor: colors.primary }]}
            onPress={() => connectBridge(bridgeUrl)}
          >
            <Text style={styles.bannerButtonText}>Connect</Text>
          </Pressable>
        </RNView>
      )}

      {connectionState === 'connecting' && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusConnecting + '20' }]}>
          <RNView style={styles.bannerContent}>
            <Ionicons name="cloud" size={18} color={colors.statusConnecting} />
            <Text style={[styles.bannerText, { color: colors.statusConnecting }]}>
              Connecting to Bridge...
            </Text>
          </RNView>
        </RNView>
      )}

      {connectionState === 'reconnecting' && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusConnecting + '20' }]}>
          <RNView style={styles.bannerContent}>
            <Ionicons name="refresh" size={18} color={colors.statusConnecting} />
            <Text style={[styles.bannerText, { color: colors.statusConnecting }]}>
              Reconnecting to Bridge...
            </Text>
          </RNView>
        </RNView>
      )}

      {connectionState === 'connected' && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusConnected + '20' }]}>
          <RNView style={styles.bannerContent}>
            <Ionicons name="cloud-done" size={18} color={colors.statusConnected} />
            <Text style={[styles.bannerText, { color: colors.statusConnected }]}>
              Connected to Bridge
            </Text>
          </RNView>
          <Pressable
            style={[styles.bannerButton, { backgroundColor: colors.error }]}
            onPress={() => disconnectBridge()}
          >
            <Text style={styles.bannerButtonText}>Disconnect</Text>
          </Pressable>
        </RNView>
      )}

      {/* Host List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {!isConnected ? (
          <RNView style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Connect to Bridge
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Connect to the bridge to view and manage hosts.
            </Text>
          </RNView>
        ) : configuredHostsLoading ? (
          <RNView style={styles.emptyState}>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Loading hosts...
            </Text>
          </RNView>
        ) : configuredHosts.length === 0 ? (
          <RNView style={styles.emptyState}>
            <Ionicons name="server-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No SSH Hosts Configured
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Add SSH hosts in Settings to get started.
            </Text>
          </RNView>
        ) : (
          configuredHosts.map(host => (
            <HostCard
              key={host.id}
              host={host}
              connectedHost={getConnectedHost(host.id)}
              selectedProcessId={selectedProcessId}
              onConnect={() => handleConnect(host.id)}
              onDisconnect={() => handleDisconnect(host.id)}
              onNewShell={() => handleNewShell(host.id)}
              onSelectProcess={handleSelectProcess}
              onStartClaude={(processId) => handleStartClaude(processId)}
              onStartClaudeLongPress={handleStartClaudeLongPress}
              onKillClaude={handleKillClaude}
              onKillProcess={handleKillProcess}
              onKillStaleProcess={(stale) => handleKillStaleProcess(host.id, stale)}
              onReattachStaleProcess={(stale) => handleReattachStaleProcess(host.id, stale)}
              onRefreshRequirements={() => handleRefreshRequirements(host.id)}
              onEnvVars={() => handleOpenEnvVars(host.id)}
              onPorts={() => handleOpenPorts(host.id)}
            />
          ))
        )}
      </ScrollView>

      {/* Env Vars Modal */}
      {envModalHostId && (() => {
        const host = configuredHosts.find(h => h.id === envModalHostId);
        const connectedHost = getConnectedHost(envModalHostId);
        if (!host || !connectedHost) return null;

        return (
          <EnvVarsModal
            visible={true}
            hostId={envModalHostId}
            hostName={host.name}
            systemVars={connectedHost.envSystemVars ?? []}
            customVars={connectedHost.envCustomVars ?? []}
            rcFile={connectedHost.envRcFile ?? ''}
            detectedRcFile={connectedHost.envDetectedRcFile ?? ''}
            loading={connectedHost.envLoading}
            onClose={handleCloseEnvVars}
            onSave={(vars) => handleSaveEnvVars(envModalHostId, vars)}
            onChangeRcFile={(rcFile) => handleChangeRcFile(envModalHostId, rcFile)}
          />
        );
      })()}

      {/* Ports Modal */}
      {portsModalHostId && (() => {
        const host = configuredHosts.find(h => h.id === portsModalHostId);
        if (!host) return null;

        return (
          <PortsModal
            visible={true}
            hostId={portsModalHostId}
            hostName={host.name}
            ports={portsData.ports}
            netTool={portsData.netTool}
            netToolError={portsData.netToolError}
            loading={portsData.loading}
            error={portsData.error}
            onClose={handleClosePorts}
            onRefresh={handleRefreshPorts}
          />
        );
      })()}

      {/* Claude Options Modal */}
      <ClaudeOptionsModal
        visible={claudeOptionsProcessId !== null}
        onClose={handleClaudeOptionsClose}
        onStart={handleClaudeOptionsStart}
      />
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    gap: 8,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  bannerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  bannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bannerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
});
