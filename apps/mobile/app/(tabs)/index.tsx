import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { StyleSheet, ScrollView, View as RNView, RefreshControl, View, Pressable } from 'react-native';
import { Text } from '@/components/Themed';
import { HostCard } from '@/components/hosts';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useConnectionState } from '@/providers/BridgeProvider';
import {
  useSettingsStore,
  useToastStore,
  selectHosts,
  selectBridgeUrl,
  getHostCredential,
} from '@/stores';
import { Messages } from '@remote-claude/shared-types';
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
    hosts: hostsMap,
    selectedProcessId,
    selectProcess,
    setHostConnecting,
    setHostDisconnected,
    setHostError,
    setHostRequirementsChecking,
  } = useBridge();
  const { connectionState } = useConnectionState();
  const [refreshing, setRefreshing] = React.useState(false);

  // Settings store (configured hosts)
  const hosts = useSettingsStore(selectHosts);
  const bridgeUrl = useSettingsStore(selectBridgeUrl);

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
      const autoConnectHosts = hosts.filter(h =>
        h.autoConnect && !hostsMap.has(h.id)
      );

      if (autoConnectHosts.length > 0) {
        autoConnectingRef.current = true;

        // Auto-connect each host
        const connectHost = async (host: typeof hosts[0]) => {
          setHostConnecting(host.id);
          const credential = await getHostCredential(host.id);
          if (!credential) {
            setHostError(host.id, 'No credential found for auto-connect.');
            return;
          }

          sendMessage(Messages.hostConnect({
            hostId: host.id,
            host: host.host,
            port: host.port,
            username: host.username,
            authType: host.authType,
            ...(host.authType === 'password' ? { password: credential } : { privateKey: credential }),
          }));
        };

        // Connect all auto-connect hosts
        Promise.all(autoConnectHosts.map(connectHost)).finally(() => {
          autoConnectingRef.current = false;
        });
      }
    }
  }, [connectionState, hosts, hostsMap, setHostConnecting, setHostError, sendMessage]);

  // ============================================================================
  // Actions
  // ============================================================================

  const handleConnect = useCallback(async (hostId: string) => {
    const host = hosts.find(h => h.id === hostId);
    if (!host) return;

    setHostConnecting(hostId);

    // Get credential from secure storage
    const credential = await getHostCredential(hostId);
    if (!credential) {
      setHostError(hostId, 'No credential found. Please update host settings.');
      return;
    }

    // Send connect message
    sendMessage(Messages.hostConnect({
      hostId: host.id,
      host: host.host,
      port: host.port,
      username: host.username,
      authType: host.authType,
      ...(host.authType === 'password' ? { password: credential } : { privateKey: credential }),
    }));
  }, [hosts, setHostConnecting, setHostError, sendMessage]);

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

  const handleStartClaude = useCallback((processId: string) => {
    sendMessage(Messages.claudeStart({ processId }));
  }, [sendMessage]);

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
  // Render
  // ============================================================================

  const getConnectedHost = (hostId: string) =>
    connectedHosts.find(ch => ch.id === hostId);

  const isDisconnected = connectionState === 'disconnected';

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
        {hosts.length === 0 ? (
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
          hosts.map(host => (
            <HostCard
              key={host.id}
              host={host}
              connectedHost={getConnectedHost(host.id)}
              selectedProcessId={selectedProcessId}
              onConnect={() => handleConnect(host.id)}
              onDisconnect={() => handleDisconnect(host.id)}
              onNewShell={() => handleNewShell(host.id)}
              onSelectProcess={handleSelectProcess}
              onStartClaude={handleStartClaude}
              onKillClaude={handleKillClaude}
              onKillProcess={handleKillProcess}
              onKillStaleProcess={(stale) => handleKillStaleProcess(host.id, stale)}
              onReattachStaleProcess={(stale) => handleReattachStaleProcess(host.id, stale)}
              onRefreshRequirements={() => handleRefreshRequirements(host.id)}
            />
          ))
        )}
      </ScrollView>
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
