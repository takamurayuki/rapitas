/**
 * ai-chat.types
 *
 * Type definitions for the in-app AI chat interface: messages, state, actions, and service responses.
 * Previously located under the floating-ai-menu feature; now part of the Note modal AI tab.
 */

export type AIChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

export type AIChatState = {
  messages: AIChatMessage[];
  isLoading: boolean;
  error: string | null;
  isExpanded: boolean;
};

export type AIChatAction =
  | { type: 'ADD_MESSAGE'; payload: AIChatMessage }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_EXPANDED'; payload: boolean }
  | { type: 'CLEAR_MESSAGES' };

export type AIServiceResponse = {
  success: boolean;
  message?: string;
  error?: string;
};
