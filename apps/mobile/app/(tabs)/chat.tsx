import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { Text } from '@/components/Themed';
import { MessageList, ChatInputBar, StatusBar } from '@/components/chat';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler, useConnectionState } from '@/providers/BridgeProvider';
import {
  useHostStore,
  useChatStore,
  selectSelectedProcessId,
  selectHostsMap,
} from '@/stores';
import {
  Message,
  Messages,
  MessageTypes,
  ChatEventPayload,
  ChatMessagesPayload,
  ChatStatusResultPayload,
} from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Chat Screen
// ============================================================================

export default function ChatScreen() {
  const colors = useThemeColors();
  const { sendMessage } = useBridge();
  const { connectionState } = useConnectionState();

  // Host store - use useShallow for Map to prevent infinite re-renders
  const hostsMap = useHostStore(useShallow(selectHostsMap));
  const selectedProcessId = useHostStore(selectSelectedProcessId);
  const { selectProcess } = useHostStore();

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
    const processes: any[] = [];
    for (const host of hostsMap.values()) {
      // Defensive: handle null/undefined processes array from Bridge
      if (host.processes) {
        processes.push(...host.processes);
      }
    }
    return processes;
  }, [hostsMap]);

  // Chat store
  const {
    initSession,
    setSubscribed,
    setMessages,
    handleChatEvent,
    setStatus,
    getSession,
  } = useChatStore();

  const processId = selectedProcess?.id ?? '';
  const session = useChatStore(useCallback(
    (state) => processId ? state.sessions.get(processId) : undefined,
    [processId]
  ));

  const messages = session?.messages ?? [];
  const status = session?.status ?? 'disconnected';
  const isSubscribed = session?.isSubscribed ?? false;
  const agentType = session?.agentType;

  const isConnected = connectionState === 'connected';
  const isClaude = selectedProcess?.type === 'claude';
  const isReady = isClaude && selectedProcess?.agentApiReady;

  // ============================================================================
  // Subscribe to chat events when process is selected
  // ============================================================================

  useEffect(() => {
    if (!isConnected || !selectedProcess || !isClaude || !isReady) {
      return;
    }

    // Initialize session if needed
    if (!session) {
      initSession(processId, selectedProcess.hostId);
    }

    // Subscribe to chat
    if (!isSubscribed) {
      sendMessage(Messages.chatSubscribe({
        hostId: selectedProcess.hostId,
        processId,
      }));
      setSubscribed(processId, true);

      // Request status and history
      sendMessage(Messages.chatStatus({
        hostId: selectedProcess.hostId,
        processId,
      }));
      sendMessage(Messages.chatHistory({
        hostId: selectedProcess.hostId,
        processId,
      }));
    }

    return () => {
      // Unsubscribe when leaving
      if (isSubscribed) {
        sendMessage(Messages.chatUnsubscribe({
          hostId: selectedProcess.hostId,
          processId,
        }));
        setSubscribed(processId, false);
      }
    };
  }, [isConnected, processId, isClaude, isReady, isSubscribed]);

  // ============================================================================
  // Message Handlers
  // ============================================================================

  // Handle chat events (message updates, status changes)
  useMessageHandler<ChatEventPayload>(
    MessageTypes.CHAT_EVENT,
    useCallback((msg: Message<ChatEventPayload>) => {
      if (msg.payload.processId === processId) {
        handleChatEvent(msg.payload);
      }
    }, [processId, handleChatEvent]),
    [processId, handleChatEvent]
  );

  // Handle chat history
  useMessageHandler<ChatMessagesPayload>(
    MessageTypes.CHAT_MESSAGES,
    useCallback((msg: Message<ChatMessagesPayload>) => {
      if (msg.payload.processId === processId) {
        setMessages(processId, msg.payload.messages);
      }
    }, [processId, setMessages]),
    [processId, setMessages]
  );

  // Handle status result
  useMessageHandler<ChatStatusResultPayload>(
    MessageTypes.CHAT_STATUS_RESULT,
    useCallback((msg: Message<ChatStatusResultPayload>) => {
      if (msg.payload.processId === processId) {
        setStatus(processId, msg.payload.status, msg.payload.agentType);
      }
    }, [processId, setStatus]),
    [processId, setStatus]
  );

  // ============================================================================
  // Actions
  // ============================================================================

  const handleSend = useCallback((content: string) => {
    if (!selectedProcess) return;
    sendMessage(Messages.chatSend({
      hostId: selectedProcess.hostId,
      processId,
      content,
    }));
  }, [selectedProcess, processId, sendMessage]);

  const handleSendRaw = useCallback((content: string) => {
    if (!selectedProcess) return;
    sendMessage(Messages.chatRaw({
      hostId: selectedProcess.hostId,
      processId,
      content,
    }));
  }, [selectedProcess, processId, sendMessage]);

  // ============================================================================
  // Process Selector
  // ============================================================================

  const claudeProcesses = allProcesses.filter(p => p.type === 'claude');

  const renderProcessSelector = () => {
    if (claudeProcesses.length === 0) return null;

    return (
      <View style={[styles.processSelector, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
        <Text style={[styles.selectorLabel, { color: colors.textSecondary }]}>Chat:</Text>
        <View style={styles.processList}>
          {claudeProcesses.map(proc => (
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
                name="chatbubble-ellipses"
                size={12}
                color={selectedProcess?.id === proc.id ? '#fff' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.processChipText,
                  { color: selectedProcess?.id === proc.id ? '#fff' : colors.text },
                ]}
                numberOfLines={1}
              >
                {proc.cwd.split('/').pop() || 'claude'}
              </Text>
            </Pressable>
          ))}
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
            Connect to the Bridge to chat with Claude.
          </Text>
        </View>
      </View>
    );
  }

  if (!selectedProcess || !isClaude) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderProcessSelector()}
        <View style={styles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {claudeProcesses.length === 0 ? 'No Claude Processes' : 'Select a Chat'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {claudeProcesses.length === 0
              ? 'Convert a shell to Claude from the Hosts tab.'
              : 'Select a Claude process above to view the chat.'}
          </Text>
        </View>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderProcessSelector()}
        <View style={styles.emptyState}>
          <Ionicons name="hourglass" size={48} color={colors.statusConnecting} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Claude Starting...
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Waiting for AgentAPI to be ready.
          </Text>
        </View>
      </View>
    );
  }

  // ============================================================================
  // Main Chat View
  // ============================================================================

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 24}
    >
      {renderProcessSelector()}

      <StatusBar
        status={status}
        agentType={agentType}
        processId={processId}
        isClaude={isClaude}
        shellPid={selectedProcess?.shellPid}
        agentApiPid={selectedProcess?.agentApiPid}
      />

      <MessageList messages={messages} isLoading={status === 'running'} />

      <ChatInputBar
        onSend={handleSend}
        onSendRaw={handleSendRaw}
        isLoading={status === 'running'}
        disabled={!isReady}
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
    maxWidth: 120,
  },
  processChipText: {
    fontSize: 12,
    fontWeight: '500',
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
