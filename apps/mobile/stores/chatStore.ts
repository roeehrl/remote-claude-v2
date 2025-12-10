import { create } from 'zustand';
import { ChatMessage, ChatEventPayload, MessageUpdateData, StatusChangeData } from '@remote-claude/shared-types';

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = 'running' | 'stable' | 'disconnected';

export interface ChatSession {
  processId: string;
  hostId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  agentType?: string;
  isSubscribed: boolean;
}

export interface ChatStoreState {
  // Chat sessions keyed by processId
  sessions: Map<string, ChatSession>;

  // Actions
  initSession: (processId: string, hostId: string) => void;
  setSubscribed: (processId: string, subscribed: boolean) => void;
  setMessages: (processId: string, messages: ChatMessage[]) => void;
  addOrUpdateMessage: (processId: string, message: MessageUpdateData) => void;
  setStatus: (processId: string, status: AgentStatus, agentType?: string) => void;
  handleChatEvent: (event: ChatEventPayload) => void;
  clearSession: (processId: string) => void;
  getSession: (processId: string) => ChatSession | undefined;
}

// ============================================================================
// Store
// ============================================================================

export const useChatStore = create<ChatStoreState>((set, get) => ({
  sessions: new Map(),

  initSession: (processId: string, hostId: string) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      if (!newSessions.has(processId)) {
        newSessions.set(processId, {
          processId,
          hostId,
          messages: [],
          status: 'disconnected',
          isSubscribed: false,
        });
      }
      return { sessions: newSessions };
    });
  },

  setSubscribed: (processId: string, subscribed: boolean) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      const session = newSessions.get(processId);
      if (session) {
        newSessions.set(processId, { ...session, isSubscribed: subscribed });
      }
      return { sessions: newSessions };
    });
  },

  setMessages: (processId: string, messages: ChatMessage[]) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      const session = newSessions.get(processId);
      if (session) {
        newSessions.set(processId, { ...session, messages });
      }
      return { sessions: newSessions };
    });
  },

  addOrUpdateMessage: (processId: string, message: MessageUpdateData) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      const session = newSessions.get(processId);
      if (session) {
        const existingIndex = session.messages.findIndex(m => m.id === message.id);
        let newMessages: ChatMessage[];

        if (existingIndex >= 0) {
          // Update existing message (streaming update)
          newMessages = [...session.messages];
          newMessages[existingIndex] = {
            id: message.id,
            role: message.role,
            message: message.message,
            time: message.time,
          };
        } else {
          // Add new message
          newMessages = [...session.messages, {
            id: message.id,
            role: message.role,
            message: message.message,
            time: message.time,
          }];
        }

        newSessions.set(processId, { ...session, messages: newMessages });
      }
      return { sessions: newSessions };
    });
  },

  setStatus: (processId: string, status: AgentStatus, agentType?: string) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      const session = newSessions.get(processId);
      if (session) {
        newSessions.set(processId, {
          ...session,
          status,
          agentType: agentType ?? session.agentType,
        });
      }
      return { sessions: newSessions };
    });
  },

  handleChatEvent: (event: ChatEventPayload) => {
    const { processId, event: eventType, data } = event;

    if (eventType === 'message_update') {
      get().addOrUpdateMessage(processId, data as MessageUpdateData);
    } else if (eventType === 'status_change') {
      const statusData = data as StatusChangeData;
      get().setStatus(processId, statusData.status, statusData.agentType);
    }
  },

  clearSession: (processId: string) => {
    set(state => {
      const newSessions = new Map(state.sessions);
      newSessions.delete(processId);
      return { sessions: newSessions };
    });
  },

  getSession: (processId: string) => {
    return get().sessions.get(processId);
  },
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectSession = (processId: string) => (state: ChatStoreState) =>
  state.sessions.get(processId);

export const selectMessages = (processId: string) => (state: ChatStoreState) =>
  state.sessions.get(processId)?.messages ?? [];

export const selectStatus = (processId: string) => (state: ChatStoreState) =>
  state.sessions.get(processId)?.status ?? 'disconnected';

export const selectIsSubscribed = (processId: string) => (state: ChatStoreState) =>
  state.sessions.get(processId)?.isSubscribed ?? false;
