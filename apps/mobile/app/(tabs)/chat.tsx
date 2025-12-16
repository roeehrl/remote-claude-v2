import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, Platform, KeyboardAvoidingView, ActivityIndicator, Pressable, Animated } from 'react-native';
import { Text } from '@/components/Themed';
import { MessageList, ChatInputBar } from '@/components/chat';
import type { MessageListRef } from '@/components/chat';
import { ProcessEnvModal } from '@/components/terminal';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useBridge, useMessageHandler, useConnectionState } from '@/providers/BridgeProvider';
import { useVoice } from '@/hooks';
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
  EnvVar,
  ProcessEnvResultPayload,
} from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// Local type for agent status
type AgentStatus = 'running' | 'stable' | 'disconnected';

// ============================================================================
// Chat Screen
// ============================================================================

export default function ChatScreen() {
  const colors = useThemeColors();
  const { sendMessage, hosts: hostsMap, selectedProcessId } = useBridge();
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

  // Scroll to bottom button state
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messageListRef = useRef<MessageListRef>(null);
  const scrollButtonOpacity = useRef(new Animated.Value(0)).current;

  // Process env modal state
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envModalLoading, setEnvModalLoading] = useState(false);
  const [envModalVars, setEnvModalVars] = useState<EnvVar[]>([]);
  const [envModalError, setEnvModalError] = useState<string | undefined>();

  const processId = selectedProcess?.id ?? '';
  const isConnected = connectionState === 'connected';
  const isClaude = selectedProcess?.type === 'claude';
  const isReady = isClaude && selectedProcess?.agentApiReady;

  // Track last spoken message ID to avoid repeating
  const lastSpokenMessageIdRef = useRef<number | null>(null);

  // Voice integration
  const {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    speechRecognitionAvailable,
    speak,
    stopSpeaking,
    isSpeaking,
    ttsEnabled,
    setTtsEnabled,
  } = useVoice({
    onSpeechResult: (transcript) => {
      // Auto-send the recognized speech
      if (selectedProcess && transcript.trim()) {
        sendMessage(Messages.chatSend({
          hostId: selectedProcess.hostId,
          processId,
          content: transcript,
        }));
      }
    },
  });

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

          // Speak assistant messages when TTS is enabled and status becomes stable
          // We'll handle this in the status_change event to speak complete messages
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

  // Handle process env result
  useMessageHandler<ProcessEnvResultPayload>(
    MessageTypes.PROCESS_ENV_RESULT,
    useCallback((msg: Message<ProcessEnvResultPayload>) => {
      if (msg.payload.processId === processId) {
        setEnvModalLoading(false);
        const { vars, error } = msg.payload;
        setEnvModalVars(vars || []);
        setEnvModalError(error);
      }
    }, [processId]),
    [processId]
  );

  // ============================================================================
  // TTS: Speak last assistant message when status becomes stable
  // ============================================================================

  useEffect(() => {
    if (!ttsEnabled || status !== 'stable' || messages.length === 0) return;

    // Find the last assistant message
    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistantMessage) return;

    // Only speak if we haven't spoken this message before
    if (lastSpokenMessageIdRef.current !== lastAssistantMessage.id) {
      lastSpokenMessageIdRef.current = lastAssistantMessage.id;
      speak(lastAssistantMessage.message);
    }
  }, [ttsEnabled, status, messages, speak]);

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

  // Send PTY input directly for control characters (Ctrl+C, arrows, etc.)
  const handleSendPty = useCallback((data: string) => {
    if (!selectedProcess) return;
    sendMessage(Messages.ptyInput({
      processId,
      data,
    }));
  }, [selectedProcess, processId, sendMessage]);

  // Show env modal and request env vars
  const handleShowEnv = useCallback(() => {
    if (!selectedProcess) return;
    setEnvModalLoading(true);
    setEnvModalVars([]);
    setEnvModalError(undefined);
    setShowEnvModal(true);
    sendMessage(Messages.processEnvList({ processId }));
  }, [selectedProcess, processId, sendMessage]);

  // Close env modal
  const handleCloseEnvModal = useCallback(() => {
    setShowEnvModal(false);
    setEnvModalVars([]);
    setEnvModalError(undefined);
  }, []);

  // ============================================================================
  // Scroll Button Handlers
  // ============================================================================

  // Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: showScrollButton ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [showScrollButton, scrollButtonOpacity]);

  // Handle scroll away from bottom callback
  const handleScrollAwayFromBottom = useCallback((isAway: boolean) => {
    setShowScrollButton(isAway);
  }, []);

  // Handle scroll to bottom button press
  const handleScrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToEnd(true);
  }, []);

  // ============================================================================
  // Helpers
  // ============================================================================

  const claudeProcesses = allProcesses.filter(p => p.type === 'claude');

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
        <View style={styles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {claudeProcesses.length === 0 ? 'No Claude Processes' : 'Select a Chat'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {claudeProcesses.length === 0
              ? 'Convert a shell to Claude from the Hosts tab.'
              : 'Select a Claude process from the header.'}
          </Text>
        </View>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
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
      {/* Compact status bar */}
      <View style={[styles.statusBar, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border }]}>
        <View style={styles.statusLeft}>
          {status === 'running' ? (
            <ActivityIndicator size="small" color={getStatusColor()} />
          ) : (
            <Ionicons
              name={status === 'stable' ? 'checkmark-circle' : 'close-circle'}
              size={16}
              color={getStatusColor()}
            />
          )}
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {status === 'running' ? 'Processing...' : status === 'stable' ? 'Ready' : 'Disconnected'}
          </Text>
        </View>
        <View style={styles.statusRight}>
          {agentType && (
            <Text style={[styles.agentType, { color: colors.textSecondary }]}>
              {agentType}
            </Text>
          )}
          {/* TTS Toggle Button */}
          <Pressable
            style={[
              styles.envButton,
              { backgroundColor: ttsEnabled ? colors.statusConnected : colors.backgroundTertiary },
            ]}
            onPress={() => {
              if (isSpeaking) {
                stopSpeaking();
              }
              setTtsEnabled(!ttsEnabled);
            }}
          >
            <Ionicons
              name={ttsEnabled ? 'volume-high' : 'volume-mute'}
              size={12}
              color={ttsEnabled ? '#fff' : colors.textSecondary}
            />
            <Text style={[styles.envButtonText, { color: ttsEnabled ? '#fff' : colors.textSecondary }]}>
              {ttsEnabled ? 'TTS' : 'TTS'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.envButton, { backgroundColor: colors.primary }]}
            onPress={handleShowEnv}
          >
            <Ionicons name="key-outline" size={12} color="#fff" />
            <Text style={styles.envButtonText}>Env</Text>
          </Pressable>
        </View>
      </View>

      {/* Message list with scroll tracking */}
      <View style={styles.messageListContainer}>
        <MessageList
          ref={messageListRef}
          messages={messages}
          isLoading={status === 'running'}
          onScrollAwayFromBottom={handleScrollAwayFromBottom}
        />

        {/* Floating scroll to bottom button */}
        <Animated.View
          style={[
            styles.scrollButtonContainer,
            { opacity: scrollButtonOpacity },
          ]}
          pointerEvents={showScrollButton ? 'auto' : 'none'}
        >
          <Pressable
            style={[styles.scrollButton, { backgroundColor: colors.primary }]}
            onPress={handleScrollToBottom}
            accessibilityLabel="Scroll to bottom"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </Pressable>
        </Animated.View>
      </View>

      <ChatInputBar
        onSend={handleSend}
        onSendPty={handleSendPty}
        isLoading={status === 'running'}
        disabled={!isReady}
        isListening={isListening}
        interimTranscript={interimTranscript}
        speechRecognitionAvailable={speechRecognitionAvailable}
        onStartListening={startListening}
        onStopListening={stopListening}
      />

      {/* Process Env Modal */}
      <ProcessEnvModal
        visible={showEnvModal}
        processName={selectedProcess?.name || selectedProcess?.id || 'Process'}
        vars={envModalVars}
        loading={envModalLoading}
        error={envModalError}
        onClose={handleCloseEnvModal}
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
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  agentType: {
    fontSize: 11,
    fontWeight: '500',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  envButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  envButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  messageListContainer: {
    flex: 1,
    position: 'relative',
  },
  scrollButtonContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    // Elevation for Android
    elevation: 5,
  },
  scrollButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
