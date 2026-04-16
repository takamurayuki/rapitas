'use client';
// AITabContent
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send,
  Loader2,
  Trash2,
  Settings,
  AlertCircle,
  MessageCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useAIChat } from './useAIChat';
import { fetchConfiguredProviders, fetchAvailableModels } from './ai-service';
import ChatMessage from './chat-message';
import type { ApiProvider } from '@/types';

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

/** AI assistant system prompt used for all conversations in this tab. */
const SYSTEM_PROMPT =
  'あなたはRapi+アプリケーションのAIアシスタントです。ユーザーのタスク管理、学習、開発作業に関する質問に日本語で丁寧に回答してください。\n\n回答は適切にマークダウン形式でフォーマットしてください：\n- 見出しには # ## ### を使用\n- コードブロックには ```言語名 を使用\n- リストには - または 1. 2. 3. を使用\n- 重要な部分は **太字** で強調\n- インラインコードは `バッククォート` で囲む';

/**
 * Renders the full AI chat tab content including settings panel, message list,
 * and input form.
 */
export default function AITabContent() {
  const [inputValue, setInputValue] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    systemPrompt: SYSTEM_PROMPT,
    provider: selectedProvider,
    model: selectedModel || undefined,
  });

  useEffect(() => {
    fetchConfiguredProviders().then((providers) => {
      setConfiguredProviders(providers);
      if (providers.length > 0 && !providers.includes(selectedProvider)) {
        setSelectedProvider(providers[0]);
      }
    });
    fetchAvailableModels().then(setAvailableModels);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    // NOTE: Delay ensures the textarea is mounted and focusable after tab switch.
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

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
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    },
    [],
  );

  const currentModels = availableModels[selectedProvider] || [];

  return (
    <div className="flex flex-col h-full">
      {/* AI settings bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          {configuredProviders.length > 0 && (
            <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {PROVIDER_LABELS[selectedProvider]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition-colors ${
              showSettings
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
            title="AI設定"
          >
            <Settings className="w-4 h-4" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              title="会話をクリア"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Provider/model selection panel */}
      {showSettings && (
        <div className="px-3 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              AIプロバイダー
            </label>
            <div className="flex gap-1.5">
              {(['claude', 'chatgpt', 'gemini'] as ApiProvider[]).map((p) => {
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
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-linear-to-r from-blue-500 to-indigo-600 text-white'
                        : isConfigured
                          ? 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-600'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                        isConfigured
                          ? PROVIDER_COLORS[p]
                          : 'bg-zinc-300 dark:bg-zinc-600'
                      }`}
                    />
                    {PROVIDER_LABELS[p]}
                  </button>
                );
              })}
            </div>
            {configuredProviders.length === 0 && (
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
              >
                <Settings className="w-3 h-3" />
                設定画面でAPIキーを登録
              </Link>
            )}
          </div>
          {currentModels.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                モデル
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-2 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-700 rounded-full mb-3">
              <MessageCircle className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
            </div>
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              AIアシスタント
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
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
              <div className="flex justify-start mb-3">
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
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

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-red-50 dark:bg-red-900/30">
          <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* Message input */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-700">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-10 max-h-[120px]"
            rows={1}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="px-3 py-2 bg-linear-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-zinc-300 disabled:to-zinc-300 dark:disabled:from-zinc-700 dark:disabled:to-zinc-700 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 text-center">
          Enter で送信・Shift+Enter で改行
        </p>
      </div>
    </div>
  );
}
