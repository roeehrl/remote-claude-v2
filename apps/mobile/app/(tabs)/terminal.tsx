import React, { useMemo, useCallback } from 'react';
import { StyleSheet, View, Pressable, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { Text } from '@/components/Themed';
import { TerminalView } from '@/components/terminal';
// Only import TerminalInputBar for web - native uses xterm.js which handles input directly
import { TerminalInputBar } from '@/components/terminal';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useConnectionState } from '@/providers/BridgeProvider';
import { ProcessInfo, Messages } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Terminal Screen
// ============================================================================

export default function TerminalScreen() {
  const colors = useThemeColors();
  const { sendMessage, hosts: hostsMap, selectedProcessId, selectProcess } = useBridge();
  const { connectionState } = useConnectionState();

  // Derive selected process and all processes from hostsMap
  const selectedProcess = useMemo(() => {
    if (!selectedProcessId) return undefined;
    for (const host of hostsMap.values()) {
      const process = (host.processes || []).find(p => p.id === selectedProcessId);
      if (process) return process;
    }
    return undefined;
  }, [hostsMap, selectedProcessId]);

  const allProcesses = useMemo(() => {
    const processes: ProcessInfo[] = [];
    for (const host of hostsMap.values()) {
      // Defensive: handle null/undefined processes array from Bridge
      if (host.processes) {
        processes.push(...host.processes);
      }
    }
    return processes;
  }, [hostsMap]);

  const isConnected = connectionState === 'connected';

  // ============================================================================
  // Action Handlers
  // ============================================================================

  const handleStartClaude = useCallback(() => {
    if (!selectedProcess) return;
    sendMessage(Messages.claudeStart({ processId: selectedProcess.id }));
  }, [selectedProcess, sendMessage]);

  const handleExitClaude = useCallback(() => {
    if (!selectedProcess) return;
    sendMessage(Messages.claudeKill({ processId: selectedProcess.id }));
  }, [selectedProcess, sendMessage]);

  const handleKillProcess = useCallback(() => {
    if (!selectedProcess) return;

    const confirmKill = () => {
      sendMessage(Messages.processKill({ processId: selectedProcess.id }));
      selectProcess(null);
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to kill this process?')) {
        confirmKill();
      }
    } else {
      Alert.alert(
        'Kill Process',
        'Are you sure you want to kill this process?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Kill', style: 'destructive', onPress: confirmKill },
        ]
      );
    }
  }, [selectedProcess, sendMessage, selectProcess]);

  // ============================================================================
  // Process Selector
  // ============================================================================

  const renderProcessSelector = () => {
    if (allProcesses.length === 0) return null;

    return (
      <View style={[styles.processSelector, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
        <Text style={[styles.selectorLabel, { color: colors.textSecondary }]}>Process:</Text>
        <View style={styles.processList}>
          {allProcesses.map(proc => (
            <Pressable
              key={proc.id}
              style={[
                styles.processChip,
                {
                  backgroundColor: selectedProcess?.id === proc.id ? colors.primary : colors.backgroundTertiary,
                },
              ]}
              onPress={() => selectProcess(proc.id)}
            >
              <Ionicons
                name={proc.type === 'claude' ? 'chatbubble-ellipses' : 'terminal'}
                size={12}
                color={selectedProcess?.id === proc.id ? '#fff' : colors.textSecondary}
              />
              <View style={styles.processChipContent}>
                <Text
                  style={[
                    styles.processChipText,
                    { color: selectedProcess?.id === proc.id ? '#fff' : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {proc.cwd.split('/').pop() || 'shell'}
                </Text>
                <Text
                  style={[
                    styles.processChipPid,
                    { color: selectedProcess?.id === proc.id ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  PID: {proc.shellPid || '—'}
                  {proc.type === 'claude' && proc.agentApiPid ? ` / API: ${proc.agentApiPid}` : ''}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  // ============================================================================
  // Action Bar (for selected process)
  // ============================================================================

  const renderActionBar = () => {
    if (!selectedProcess) return null;

    const isShell = selectedProcess.type === 'shell';
    const isClaude = selectedProcess.type === 'claude';

    return (
      <View style={[styles.actionBar, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
        <View style={styles.processInfo}>
          <Text style={[styles.processInfoText, { color: colors.text }]}>
            {selectedProcess.cwd.split('/').pop() || 'shell'}
          </Text>
          <Text style={[styles.processInfoPid, { color: colors.textSecondary }]}>
            PID: {selectedProcess.shellPid || '—'}
            {isClaude && selectedProcess.agentApiPid ? ` | AgentAPI: ${selectedProcess.agentApiPid}` : ''}
          </Text>
        </View>
        <View style={styles.actionButtons}>
          {isShell && (
            <Pressable
              style={[styles.actionButton, { backgroundColor: colors.success }]}
              onPress={handleStartClaude}
            >
              <Ionicons name="chatbubble-ellipses" size={14} color="#fff" />
              <Text style={styles.actionButtonText}>Start Claude</Text>
            </Pressable>
          )}
          {isClaude && (
            <Pressable
              style={[styles.actionButton, { backgroundColor: colors.warning }]}
              onPress={handleExitClaude}
            >
              <Ionicons name="exit-outline" size={14} color="#fff" />
              <Text style={styles.actionButtonText}>Exit Claude</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.error }]}
            onPress={handleKillProcess}
          >
            <Ionicons name="close-circle" size={14} color="#fff" />
            <Text style={styles.actionButtonText}>Kill</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  // ============================================================================
  // Empty States
  // ============================================================================

  if (!isConnected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline" size={48} color={colors.statusDisconnected} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Not Connected
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Connect to the Bridge to use the terminal.
          </Text>
        </View>
      </View>
    );
  }

  if (!selectedProcess) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderProcessSelector()}
        <View style={styles.emptyState}>
          <Ionicons name="terminal-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No Process Selected
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {allProcesses.length > 0
              ? 'Select a process above to view its terminal.'
              : 'Create a new shell from the Hosts tab.'}
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Main Terminal View
  // ============================================================================

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {renderProcessSelector()}
      {renderActionBar()}

      <View style={styles.terminalContainer}>
        <TerminalView processId={selectedProcess.id} />
      </View>

      {/* Input bar with quick actions for control keys */}
      <TerminalInputBar processId={selectedProcess.id} />
    </KeyboardAvoidingView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0, // Allow flex container to size correctly on web
  },
  processSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  selectorLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  processList: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  processChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    maxWidth: 160,
  },
  processChipContent: {
    flexDirection: 'column',
    flex: 1,
  },
  processChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  processChipPid: {
    fontSize: 9,
    fontWeight: '400',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  processInfo: {
    flex: 1,
  },
  processInfoText: {
    fontSize: 14,
    fontWeight: '600',
  },
  processInfoPid: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#fff',
  },
  terminalContainer: {
    flex: 1,
    overflow: 'hidden', // Ensure terminal content doesn't overflow into input bar
    minHeight: 0, // Allow flex item to shrink below content size (important for web)
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
