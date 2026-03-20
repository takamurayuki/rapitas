'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  Loader2,
  Trash2,
  Sparkles,
  Settings,
  AlertCircle,
  MessageCircle,
  X,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useAIChat } from '../note/useAIChat';
import {
  fetchConfiguredProviders,
  fetchAvailableModels,
} from '../note/aiService';
import Link from 'next/link';
import type { AIChatMessage, ApiProvider } from '@/types';
import { useUIModeStore } from '@/stores/uiModeStore';

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const PROVIDER_COLORS: Record<ApiProvider, string> = {
  claude: 'bg-orange-500',
  chatgpt: 'bg-green-500',
  gemini: 'bg-blue-500',
  ollama: 'bg-purple-500',
};

const ChatMessage = ({ message }: { message: AIChatMessage }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-br-md'
            : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md shadow-md'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {message.content}
        </p>
        <span
          className={`text-xs mt-1 block ${
            isUser ? 'text-blue-100' : 'text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {message.timestamp.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
};

export default function AIAssistantPanel() {
  const { currentMode } = useUIModeStore();
  const [inputValue, setInputValue] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Provider/model selection
  const [selectedProvider, setSelectedProvider] =
    useState<ApiProvider>('claude');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [configuredProviders, setConfiguredProviders] = useState<ApiProvider[]>(
    [],
  );
  const [availableModels, setAvailableModels] = useState<
    Record<string, { value: string; label: string }[]>
  >({});

  const { messages, isLoading, error, sendMessage, clearMessages } = useAIChat({
    systemPrompt: `あなたはRapi+アプリケーションのAIアシスタントです。ユーザーのタスク管理、学習、開発作業に関する質問に日本語で丁寧に回答してください。`,
    provider: selectedProvider,
    model: selectedModel || undefined,
  });

  // Fetch configured providers and available models
  useEffect(() => {
    fetchConfiguredProviders().then((providers) => {
      setConfiguredProviders(providers);
      if (providers.length > 0 && !providers.includes(selectedProvider)) {
        setSelectedProvider(providers[0]);
      }
    });
    fetchAvailableModels().then(setAvailableModels);
  }, []);

  // Auto-scroll message list
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when switching to AI mode
  useEffect(() => {
    if (currentMode === 'ai' && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [currentMode]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;
    const message = inputValue;
    setInputValue('');
    await sendMessage(message);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
    },
    [],
  );

  const currentModels = availableModels[selectedProvider] || [];

  // Only render when in AI mode
  if (currentMode !== 'ai') return null;

  return (
    <div className="fixed inset-0 top-16 z-30 bg-zinc-50 dark:bg-zinc-900 flex flex-col">
      {/* Main container */}
      <div className="max-w-6xl mx-auto w-full h-full flex flex-col p-4">
        {/* Header */}
        <div className="bg-white dark:bg-zinc-800 rounded-t-2xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  AIアシスタント
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  何でもお気軽にご質問ください
                </p>
              </div>
              {configuredProviders.length > 0 && (
                <span className="px-2 py-1 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-xs font-medium">
                  {PROVIDER_LABELS[selectedProvider]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings
                    ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                }`}
                title="AI設定"
              >
                <Settings className="w-5 h-5" />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="p-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  title="会話をクリア"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                title={isMinimized ? '展開' : '最小化'}
              >
                {isMinimized ? (
                  <Maximize2 className="w-5 h-5" />
                ) : (
                  <Minimize2 className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Provider/model selection panel */}
          {showSettings && (
            <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    AIプロバイダー
                  </label>
                  <div className="flex gap-2">
                    {(['claude', 'chatgpt', 'gemini'] as ApiProvider[]).map(
                      (p) => {
                        const isConfigured = configuredProviders.includes(p);
                        const isSelected = selectedProvider === p;
                        return (
                          <button
                            key={p}
                            onClick={() => {
                              if (isConfigured) {
                                setSelectedProvider(p);
                                setSelectedModel('');
                              }
                            }}
                            disabled={!isConfigured}
                            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              isSelected
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md'
                                : isConfigured
                                  ? 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-600'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                            }`}
                            title={
                              isConfigured
                                ? PROVIDER_LABELS[p]
                                : `${PROVIDER_LABELS[p]}（未設定）`
                            }
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                isConfigured
                                  ? PROVIDER_COLORS[p]
                                  : 'bg-zinc-300 dark:bg-zinc-600'
                              }`}
                            />
                            {PROVIDER_LABELS[p]}
                          </button>
                        );
                      },
                    )}
                  </div>
                  {configuredProviders.length === 0 && (
                    <Link
                      href="/settings"
                      className="inline-flex items-center gap-1 mt-2 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400"
                    >
                      <Settings className="w-4 h-4" />
                      設定画面でAPIキーを登録
                    </Link>
                  )}
                </div>

                {currentModels.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                      モデル
                    </label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">デフォルト</option>
                      {currentModels.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Message area */}
        <div
          className={`flex-1 bg-white dark:bg-zinc-800 border-x border-zinc-200 dark:border-zinc-700 overflow-hidden ${
            isMinimized ? 'h-0' : ''
          }`}
        >
          <div className="h-full overflow-y-auto p-6 custom-scrollbar">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="p-4 bg-zinc-100 dark:bg-zinc-700 rounded-full mb-4">
                  <MessageCircle className="w-12 h-12 text-zinc-400 dark:text-zinc-500" />
                </div>
                <h3 className="text-lg font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  AIアシスタントへようこそ
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
                  タスク管理、学習計画、コーディングの質問など、
                  <br />
                  あなたの作業をサポートします。
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                {isLoading && (
                  <div className="flex justify-start mb-4">
                    <div className="bg-white dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3 shadow-md">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          考え中...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Error display */}
        {error && !isMinimized && (
          <div className="bg-red-50 dark:bg-red-900/30 border-x border-zinc-200 dark:border-zinc-700 px-4 py-3">
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm">{error}</p>
                {(error.includes('APIキーが設定されていません') ||
                  error.includes('APIキーが無効です')) && (
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <Settings className="w-4 h-4" />
                    設定画面でAPIキーを設定する
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Input area */}
        <div
          className={`bg-white dark:bg-zinc-800 rounded-b-2xl border border-zinc-200 dark:border-zinc-700 p-4 ${
            isMinimized ? 'hidden' : ''
          }`}
        >
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力..."
              disabled={isLoading}
              className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] max-h-[150px]"
              rows={1}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-zinc-300 disabled:to-zinc-300 dark:disabled:from-zinc-700 dark:disabled:to-zinc-700 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2 text-center">
            Enter で送信・Shift+Enter で改行
          </p>
        </div>
      </div>
    </div>
  );
}
