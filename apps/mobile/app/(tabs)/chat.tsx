import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { Text } from '@/components/Themed';
import { MessageList, ChatInputBar, StatusBar } from '@/components/chat';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler, useConnectionState } from '@/providers/BridgeProvider';
import {
  Message,
  Messages,
  MessageTypes,
  ChatMessage,
  ChatEventPayload,
  ChatMessagesPayload,
  ChatStatusResultPayload,
  MessageUpdateData,
  StatusChangeData,
} from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// Local type for agent status
type AgentStatus = 'running' | 'stable' | 'disconnected';

// ============================================================================
// Chat Screen
// ============================================================================

export default function ChatScreen() {
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
    const processes: any[] = [];
    for (const host of hostsMap.values()) {
      // Defensive: handle null/undefined processes array from Bridge
      if (host.processes) {
        processes.push(...host.processes);
      }
    }
    return processes;
  }, [hostsMap]);

  // LOCAL STATE - no global store, component is completely stateless
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [agentType, setAgentType] = useState<string | undefined>();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const subscribedProcessRef = useRef<string | null>(null);

  const processId = selectedProcess?.id ?? '';
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

    // Reset state when switching processes
    if (subscribedProcessRef.current !== processId) {
      setMessages([]);
      setStatus('disconnected');
      setAgentType(undefined);
      setIsSubscribed(false);
      subscribedProcessRef.current = processId;

      // Subscribe to chat
      sendMessage(Messages.chatSubscribe({
        hostId: selectedProcess.hostId,
        processId,
      }));
      setIsSubscribed(true);

      // Request status and history from bridge
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
      if (subscribedProcessRef.current === processId) {
        sendMessage(Messages.chatUnsubscribe({
          hostId: selectedProcess.hostId,
          processId,
        }));
        subscribedProcessRef.current = null;
        setIsSubscribed(false);
      }
    };
  }, [isConnected, processId, isClaude, isReady, selectedProcess, sendMessage]);

  // ============================================================================
  // Message Handlers
  // ============================================================================

  // Handle chat events (message updates, status changes)
  useMessageHandler<ChatEventPayload>(
    MessageTypes.CHAT_EVENT,
    useCallback((msg: Message<ChatEventPayload>) => {
      if (msg.payload.processId === processId) {
        const { event: eventType, data } = msg.payload;

        if (eventType === 'message_update') {
          const msgData = data as MessageUpdateData;
          setMessages(prev => {
            const existingIndex = prev.findIndex(m => m.id === msgData.id);
            const newMessage: ChatMessage = {
              id: msgData.id,
              role: msgData.role,
              message: msgData.message,
              time: msgData.time,
            };

            if (existingIndex >= 0) {
              // Update existing message (streaming update)
              const updated = [...prev];
              updated[existingIndex] = newMessage;
              return updated;
            } else {
              // Add new message
              return [...prev, newMessage];
            }
          });
        } else if (eventType === 'status_change') {
          const statusData = data as StatusChangeData;
          setStatus(statusData.status);
          if (statusData.agentType) {
            setAgentType(statusData.agentType);
          }
        }
      }
    }, [processId]),
    [processId]
  );

  // Handle chat history (from bridge cache)
  useMessageHandler<ChatMessagesPayload>(
    MessageTypes.CHAT_MESSAGES,
    useCallback((msg: Message<ChatMessagesPayload>) => {
      if (msg.payload.processId === processId) {
        setMessages(msg.payload.messages);
      }
    }, [processId]),
    [processId]
  );

  // Handle status result
  useMessageHandler<ChatStatusResultPayload>(
    MessageTypes.CHAT_STATUS_RESULT,
    useCallback((msg: Message<ChatStatusResultPayload>) => {
      if (msg.payload.processId === processId) {
        setStatus(msg.payload.status);
        if (msg.payload.agentType) {
          setAgentType(msg.payload.agentType);
        }
      }
    }, [processId]),
    [processId]
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
