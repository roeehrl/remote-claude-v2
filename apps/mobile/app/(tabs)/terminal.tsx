import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { StyleSheet, View, Pressable, Platform, Alert, KeyboardAvoidingView, Text as RNText } from 'react-native';
import { Text } from '@/components/Themed';
import { TerminalView, TerminalInputBar, ProcessEnvModal, SnippetsModal } from '@/components/terminal';
import { ClaudeOptionsModal } from '@/components/shared';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useConnectionState, useMessageHandler } from '@/providers/BridgeProvider';
import { ProcessInfo, Messages, MessageTypes, EnvVar, ProcessEnvResultPayload, Snippet, SnippetListResultPayload, Message } from '@remote-claude/shared-types';
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

  // Process env modal state
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envModalLoading, setEnvModalLoading] = useState(false);
  const [envModalVars, setEnvModalVars] = useState<EnvVar[]>([]);
  const [envModalError, setEnvModalError] = useState<string | undefined>();

  // Claude options modal state
  const [showClaudeOptionsModal, setShowClaudeOptionsModal] = useState(false);

  // Snippets modal state
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetsError, setSnippetsError] = useState<string | undefined>();

  // Handle SNIPPET_LIST_RESULT messages
  useMessageHandler<SnippetListResultPayload>(
    MessageTypes.SNIPPET_LIST_RESULT,
    useCallback((msg: Message<SnippetListResultPayload>) => {
      setSnippetsLoading(false);
      setSnippets(msg.payload.snippets || []);
    }, []),
    []
  );

  // Handle PROCESS_ENV_RESULT messages
  useMessageHandler<ProcessEnvResultPayload>(
    MessageTypes.PROCESS_ENV_RESULT,
    useCallback((msg: Message<ProcessEnvResultPayload>) => {
      const { processId, vars, error } = msg.payload;
      // Only update if this is for the current process
      if (selectedProcessId === processId) {
        setEnvModalLoading(false);
        setEnvModalVars(vars || []);
        setEnvModalError(error);
      }
    }, [selectedProcessId]),
    [selectedProcessId]
  );

  // ============================================================================
  // Action Handlers
  // ============================================================================

  const handleStartClaude = useCallback((claudeArgs?: string) => {
    if (!selectedProcess) return;
    sendMessage(Messages.claudeStart({ processId: selectedProcess.id, claudeArgs }));
  }, [selectedProcess, sendMessage]);

  const handleStartClaudeLongPress = useCallback(() => {
    setShowClaudeOptionsModal(true);
  }, []);

  const handleClaudeOptionsClose = useCallback(() => {
    setShowClaudeOptionsModal(false);
  }, []);

  const handleClaudeOptionsStart = useCallback((claudeArgs?: string) => {
    console.log('[DEBUG] ClaudeOptionsStart - claudeArgs:', claudeArgs);
    handleStartClaude(claudeArgs);
    setShowClaudeOptionsModal(false);
  }, [handleStartClaude]);

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

  const handleShowEnv = useCallback(() => {
    if (!selectedProcess) return;
    setEnvModalLoading(true);
    setEnvModalVars([]);
    setEnvModalError(undefined);
    setShowEnvModal(true);
    sendMessage(Messages.processEnvList({ processId: selectedProcess.id }));
  }, [selectedProcess, sendMessage]);

  const handleCloseEnvModal = useCallback(() => {
    setShowEnvModal(false);
    setEnvModalVars([]);
    setEnvModalError(undefined);
  }, []);

  const handleShowSnippets = useCallback(() => {
    setSnippetsLoading(true);
    setSnippets([]);
    setSnippetsError(undefined);
    setShowSnippetsModal(true);
    sendMessage(Messages.snippetList());
  }, [sendMessage]);

  const handleCloseSnippetsModal = useCallback(() => {
    setShowSnippetsModal(false);
    setSnippets([]);
    setSnippetsError(undefined);
  }, []);

  const handleSelectSnippet = useCallback((snippet: Snippet) => {
    if (!selectedProcess) return;
    // Type the snippet content into the terminal
    sendMessage(Messages.ptyInput({ processId: selectedProcess.id, data: snippet.content }));
  }, [selectedProcess, sendMessage]);

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
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: colors.success,
                  opacity: pressed ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                }
              ]}
              onPress={() => handleStartClaude()}
              onLongPress={handleStartClaudeLongPress}
              delayLongPress={500}
            >
              <View style={styles.actionButtonContent} pointerEvents="none">
                <Ionicons name="chatbubble-ellipses" size={14} color="#fff" />
                <RNText style={styles.actionButtonText}>Start Claude</RNText>
              </View>
            </Pressable>
          )}
          {isClaude && (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: colors.warning,
                  opacity: pressed ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                }
              ]}
              onPress={handleExitClaude}
            >
              <Ionicons name="exit-outline" size={14} color="#fff" />
              <Text style={styles.actionButtonText}>Exit Claude</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              }
            ]}
            onPress={handleShowEnv}
          >
            <Ionicons name="key-outline" size={14} color="#fff" />
            <Text style={styles.actionButtonText}>Env</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              }
            ]}
            onPress={handleShowSnippets}
          >
            <Text style={styles.actionButtonText}>&lt;/&gt;</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.error,
                opacity: pressed ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              }
            ]}
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
        <View style={styles.emptyState}>
          <Ionicons name="terminal-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No Process Selected
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {allProcesses.length > 0
              ? 'Select a process from the header to view its terminal.'
              : 'Create a new shell from the Hosts tab.'}
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Main Terminal View
  // ============================================================================

  // Get process name for env modal
  const processName = selectedProcess.name || selectedProcess.cwd.split('/').pop() || 'shell';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {renderActionBar()}

      <View style={styles.terminalContainer}>
        <TerminalView processId={selectedProcess.id} />
      </View>

      {/* Input bar with quick actions for control keys */}
      <TerminalInputBar processId={selectedProcess.id} />

      {/* Process Env Modal */}
      <ProcessEnvModal
        visible={showEnvModal}
        processName={processName}
        vars={envModalVars}
        loading={envModalLoading}
        error={envModalError}
        onClose={handleCloseEnvModal}
      />

      {/* Snippets Modal */}
      <SnippetsModal
        visible={showSnippetsModal}
        mode="select"
        snippets={snippets}
        loading={snippetsLoading}
        error={snippetsError}
        onClose={handleCloseSnippetsModal}
        onSelect={handleSelectSnippet}
      />

      {/* Claude Options Modal */}
      <ClaudeOptionsModal
        visible={showClaudeOptionsModal}
        onClose={handleClaudeOptionsClose}
        onStart={handleClaudeOptionsStart}
      />
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
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
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
