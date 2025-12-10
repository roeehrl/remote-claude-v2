import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { StyleSheet, ScrollView, View as RNView, RefreshControl, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { Text } from '@/components/Themed';
import { HostCard } from '@/components/hosts';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler, useConnectionState } from '@/providers/BridgeProvider';
import {
  useSettingsStore,
  useHostStore,
  useToastStore,
  selectHosts,
  getHostCredential,
} from '@/stores';
import {
  Message,
  Messages,
  MessageTypes,
  HostStatusPayload,
  HostRequirementsResultPayload,
  ProcessCreatedPayload,
  ProcessKilledPayload,
  ProcessUpdatedPayload,
} from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Hosts Screen
// ============================================================================

export default function HostsScreen() {
  const colors = useThemeColors();
  const { sendMessage } = useBridge();
  const { connectionState } = useConnectionState();
  const [refreshing, setRefreshing] = React.useState(false);

  // Settings store (configured hosts)
  const hosts = useSettingsStore(selectHosts);

  // Toast store
  const { success, error: showError, info } = useToastStore();

  // Host store (connected hosts and processes)
  // Use useShallow to prevent infinite re-renders from computed arrays
  const hostsMap = useHostStore(useShallow(state => state.hosts));
  const connectedHosts = useMemo(() => Array.from(hostsMap.values()), [hostsMap]);
  const selectedProcessId = useHostStore(state => state.selectedProcessId);
  const {
    setHostConnecting,
    setHostConnected,
    setHostDisconnected,
    setHostError,
    setHostRequirements,
    setHostRequirementsChecking,
    addProcess,
    updateProcess,
    removeProcess,
    selectProcess,
  } = useHostStore();

  // ============================================================================
  // Message Handlers
  // ============================================================================

  // Handle host status updates
  useMessageHandler<HostStatusPayload>(
    MessageTypes.HOST_STATUS,
    useCallback((msg: Message<HostStatusPayload>) => {
      const payload = msg.payload;
      const hostName = hosts.find(h => h.id === payload.hostId)?.name || payload.hostId;

      if (payload.connected) {
        setHostConnected(payload.hostId, payload.processes, payload.staleProcesses, payload.requirements);
        success(`Connected to ${hostName}`, `${payload.processes.length} process(es) active`);
      } else if (payload.error) {
        setHostError(payload.hostId, payload.error);
        showError(`Connection failed`, payload.error);
      } else {
        setHostDisconnected(payload.hostId);
        info(`Disconnected from ${hostName}`);
      }
    }, [hosts, setHostConnected, setHostDisconnected, setHostError, success, showError, info]),
    [hosts, setHostConnected, setHostDisconnected, setHostError, success, showError, info]
  );

  // Handle requirements result
  useMessageHandler<HostRequirementsResultPayload>(
    MessageTypes.HOST_REQUIREMENTS_RESULT,
    useCallback((msg: Message<HostRequirementsResultPayload>) => {
      const { hostId, requirements, error } = msg.payload;
      setHostRequirementsChecking(hostId, false);
      if (!error && requirements) {
        setHostRequirements(hostId, requirements);
        if (requirements.claudeInstalled && requirements.agentApiInstalled) {
          success('Requirements check', 'All requirements installed');
        }
      }
    }, [setHostRequirements, setHostRequirementsChecking, success]),
    [setHostRequirements, setHostRequirementsChecking, success]
  );

  // Handle process created
  useMessageHandler<ProcessCreatedPayload>(
    MessageTypes.PROCESS_CREATED,
    useCallback((msg: Message<ProcessCreatedPayload>) => {
      addProcess(msg.payload.process);
      success('Shell created', 'New shell session started');
    }, [addProcess, success]),
    [addProcess, success]
  );

  // Handle process killed
  useMessageHandler<ProcessKilledPayload>(
    MessageTypes.PROCESS_KILLED,
    useCallback((msg: Message<ProcessKilledPayload>) => {
      removeProcess(msg.payload.processId);
      info('Process terminated');
    }, [removeProcess, info]),
    [removeProcess, info]
  );

  // Handle process updated
  useMessageHandler<ProcessUpdatedPayload>(
    MessageTypes.PROCESS_UPDATED,
    useCallback((msg: Message<ProcessUpdatedPayload>) => {
      const update = msg.payload;
      updateProcess(update);

      // Show toast for Claude state changes
      if (update.type === 'claude' && update.agentApiReady) {
        success('Claude ready', 'AgentAPI is now available');
      }
    }, [updateProcess, success]),
    [updateProcess, success]
  );

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

  const handleKillStaleProcess = useCallback((hostId: string, port: number) => {
    // TODO: Implement stale process killing (needs protocol support)
    console.log('Kill stale process:', hostId, port);
  }, []);

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
          <Ionicons name="cloud-offline" size={18} color={colors.statusDisconnected} />
          <Text style={[styles.bannerText, { color: colors.statusDisconnected }]}>
            Not connected to Bridge. Check Settings.
          </Text>
        </RNView>
      )}

      {connectionState === 'connecting' && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusConnecting + '20' }]}>
          <Ionicons name="cloud" size={18} color={colors.statusConnecting} />
          <Text style={[styles.bannerText, { color: colors.statusConnecting }]}>
            Connecting to Bridge...
          </Text>
        </RNView>
      )}

      {connectionState === 'reconnecting' && (
        <RNView style={[styles.banner, { backgroundColor: colors.statusConnecting + '20' }]}>
          <Ionicons name="refresh" size={18} color={colors.statusConnecting} />
          <Text style={[styles.bannerText, { color: colors.statusConnecting }]}>
            Reconnecting to Bridge...
          </Text>
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
              onKillStaleProcess={(port) => handleKillStaleProcess(host.id, port)}
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
    padding: 12,
    gap: 8,
  },
  bannerText: {
    fontSize: 14,
    fontWeight: '500',
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
