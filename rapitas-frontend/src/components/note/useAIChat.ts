"use client";

import { useReducer, useCallback, useRef } from "react";
import type { AIChatMessage, AIChatState, AIChatAction, ApiProvider } from "@/types";
import { sendMessageToAI, sendMessageToAIStream } from "./aiService";

const initialState: AIChatState = {
  messages: [],
  isLoading: false,
  error: null,
  isExpanded: false,
};

function chatReducer(state: AIChatState, action: AIChatAction): AIChatState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.payload],
        error: null,
      };
    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.payload,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };
    case "SET_EXPANDED":
      return {
        ...state,
        isExpanded: action.payload,
      };
    case "CLEAR_MESSAGES":
      return {
        ...state,
        messages: [],
        error: null,
      };
    default:
      return state;
  }
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export type UseAIChatOptions = {
  systemPrompt?: string;
  useStreaming?: boolean;
  provider?: ApiProvider;
  model?: string;
  onMessageSent?: (message: AIChatMessage) => void;
  onResponseReceived?: (message: AIChatMessage) => void;
  onError?: (error: string) => void;
};

export type UseAIChatReturn = {
  messages: AIChatMessage[];
  isLoading: boolean;
  error: string | null;
  isExpanded: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
};

export function useAIChat(options: UseAIChatOptions = {}): UseAIChatReturn {
  const {
    systemPrompt,
    useStreaming = false,
    provider,
    model,
    onMessageSent,
    onResponseReceived,
    onError,
  } = options;

  const [state, dispatch] = useReducer(chatReducer, initialState);
  const streamingMessageRef = useRef<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isLoading) return;

      const userMessage: AIChatMessage = {
        id: generateMessageId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMessage });
      onMessageSent?.(userMessage);

      dispatch({ type: "SET_LOADING", payload: true });

      if (useStreaming) {
        streamingMessageRef.current = "";
        const assistantMessageId = generateMessageId();

        const initialAssistantMessage: AIChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        };
        dispatch({ type: "ADD_MESSAGE", payload: initialAssistantMessage });

        await sendMessageToAIStream(
          {
            message: content.trim(),
            conversationHistory: [...state.messages, userMessage],
            systemPrompt,
            provider,
            model,
          },
          (chunk) => {
            streamingMessageRef.current += chunk;
          },
          () => {
            const finalMessage: AIChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: streamingMessageRef.current,
              timestamp: new Date(),
            };
            onResponseReceived?.(finalMessage);
            dispatch({ type: "SET_LOADING", payload: false });
          },
          (error) => {
            dispatch({ type: "SET_ERROR", payload: error });
            onError?.(error);
          }
        );
      } else {
        const response = await sendMessageToAI({
          message: content.trim(),
          conversationHistory: [...state.messages, userMessage],
          systemPrompt,
          provider,
          model,
        });

        if (response.success && response.message) {
          const assistantMessage: AIChatMessage = {
            id: generateMessageId(),
            role: "assistant",
            content: response.message,
            timestamp: new Date(),
          };
          dispatch({ type: "ADD_MESSAGE", payload: assistantMessage });
          onResponseReceived?.(assistantMessage);
        } else {
          const errorMessage = response.error || "応答の取得に失敗しました";
          dispatch({ type: "SET_ERROR", payload: errorMessage });
          onError?.(errorMessage);
        }

        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [
      state.isLoading,
      state.messages,
      systemPrompt,
      useStreaming,
      provider,
      model,
      onMessageSent,
      onResponseReceived,
      onError,
    ]
  );

  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: "CLEAR_MESSAGES" });
  }, []);

  const setExpanded = useCallback((expanded: boolean) => {
    dispatch({ type: "SET_EXPANDED", payload: expanded });
  }, []);

  const toggleExpanded = useCallback(() => {
    dispatch({ type: "SET_EXPANDED", payload: !state.isExpanded });
  }, [state.isExpanded]);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    error: state.error,
    isExpanded: state.isExpanded,
    sendMessage,
    clearMessages,
    setExpanded,
    toggleExpanded,
  };
}
