'use client';

import { useEffect, useState, useCallback } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Trash2,
  Save,
  Settings,
  ChevronDown,
} from 'lucide-react';
import type { UserSettings, ApiProvider } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import {
  ClaudeIcon,
  ChatGPTIcon,
  GeminiIcon,
} from '@/components/icons/ProviderIcons';
import { UsageRateLimitGraph } from '@/components/UsageRateLimitGraph';

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

const PROVIDER_DESCRIPTIONS: Record<ApiProvider, string> = {
  claude: 'Anthropic Claude API',
  chatgpt: 'OpenAI ChatGPT / GPT API',
  gemini: 'Google Gemini API',
};

type ProviderConfig = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  consoleUrl: string;
  consoleName: string;
  configuredField: keyof UserSettings;
  modelField: keyof UserSettings;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
};

const PROVIDERS: ProviderConfig[] = [
  {
    key: 'claude',
    label: 'Claude API キー',
    description: 'Anthropic Claude APIを利用するために必要です',
    placeholder: 'sk-ant-api...',
    consoleUrl: 'https://console.anthropic.com/',
    consoleName: 'Anthropic Console',
    configuredField: 'claudeApiKeyConfigured',
    modelField: 'claudeDefaultModel',
    icon: ClaudeIcon,
    iconColor: 'text-orange-500',
  },
  {
    key: 'chatgpt',
    label: 'OpenAI API キー',
    description: 'ChatGPT / GPT-4 APIを利用するために必要です',
    placeholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleName: 'OpenAI Platform',
    configuredField: 'chatgptApiKeyConfigured',
    modelField: 'chatgptDefaultModel',
    icon: ChatGPTIcon,
    iconColor: 'text-green-500',
  },
  {
    key: 'gemini',
    label: 'Gemini API キー',
    description: 'Google Gemini APIを利用するために必要です',
    placeholder: 'AIza...',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleName: 'Google AI Studio',
    configuredField: 'geminiApiKeyConfigured',
    modelField: 'geminiDefaultModel',
    icon: GeminiIcon,
    iconColor: 'text-blue-500',
  },
];

type ProviderState = {
  apiKeyInput: string;
  showApiKey: boolean;
  maskedApiKey: string | null;
  isEditing: boolean;
  isSaving: boolean;
};

const initialProviderState: ProviderState = {
  apiKeyInput: '',
  showApiKey: false,
  maskedApiKey: null,
  isEditing: false,
  isSaving: false,
};

type ModelOption = { value: string; label: string };

// Cache keys
const CACHE_KEYS = {
  settings: 'settings-cache',
  models: 'models-cache',
  apiKeys: 'api-keys-cache',
} as const;

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedData<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      }),
    );
  } catch (error) {
    console.error('Failed to cache data:', error);
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<
    Record<string, ModelOption[]>
  >({});

  const [providerStates, setProviderStates] = useState<
    Record<string, ProviderState>
  >(() => {
    const states: Record<string, ProviderState> = {};
    for (const p of PROVIDERS) {
      states[p.key] = { ...initialProviderState };
    }
    return states;
  });

  const updateProviderState = (
    providerKey: string,
    updates: Partial<ProviderState>,
  ) => {
    setProviderStates((prev) => ({
      ...prev,
      [providerKey]: { ...prev[providerKey], ...updates },
    }));
  };

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      // Check cache first
      const cached = getCachedData<UserSettings>(CACHE_KEYS.settings);
      if (cached) {
        setSettings(cached);
        setIsLoading(false);
        // Still fetch in background to update cache
        fetch(`${API_BASE_URL}/settings`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              setSettings(data);
              setCachedData(CACHE_KEYS.settings, data);
            }
          });
        return;
      }

      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setCachedData(CACHE_KEYS.settings, data);
      }
    } catch {
      setError('設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchApiKeys = useCallback(async () => {
    try {
      // Check cache first
      const cached = getCachedData<
        Record<string, { configured: boolean; maskedKey: string | null }>
      >(CACHE_KEYS.apiKeys);
      if (cached) {
        for (const [provider, info] of Object.entries(cached)) {
          if (info.configured && info.maskedKey) {
            updateProviderState(provider, { maskedApiKey: info.maskedKey });
          }
        }
      }

      const res = await fetch(`${API_BASE_URL}/settings/api-keys`);
      if (res.ok) {
        const data: Record<
          string,
          { configured: boolean; maskedKey: string | null }
        > = await res.json();
        setCachedData(CACHE_KEYS.apiKeys, data);
        for (const [provider, info] of Object.entries(data)) {
          if (info.configured && info.maskedKey) {
            updateProviderState(provider, { maskedApiKey: info.maskedKey });
          }
        }
      }
    } catch (err) {
      console.error('APIキー情報の取得に失敗:', err);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      // Check cache first
      const cached = getCachedData<Record<string, ModelOption[]>>(
        CACHE_KEYS.models,
      );
      if (cached) {
        setAvailableModels(cached);
        // Still fetch in background to update cache
        fetch(`${API_BASE_URL}/settings/models`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              setAvailableModels(data);
              setCachedData(CACHE_KEYS.models, data);
            }
          });
        return;
      }

      const res = await fetch(`${API_BASE_URL}/settings/models`);
      if (res.ok) {
        const data: Record<string, ModelOption[]> = await res.json();
        setAvailableModels(data);
        setCachedData(CACHE_KEYS.models, data);
      }
    } catch (err) {
      console.error('モデル一覧の取得に失敗:', err);
    }
  }, []);

  const saveModel = async (providerKey: string, model: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, provider: providerKey }),
      });

      if (res.ok) {
        const provider = PROVIDERS.find((p) => p.key === providerKey);
        setSettings((prev) =>
          prev
            ? { ...prev, [provider?.modelField ?? '']: model || null }
            : prev,
        );
        setSuccessMessage('デフォルトモデルを保存しました');
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? 'モデルの保存に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  };

  const saveDefaultProvider = async (provider: ApiProvider) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAiProvider: provider }),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? { ...prev, defaultAiProvider: provider } : prev,
        );
        setSuccessMessage('デフォルトAIプロバイダーを保存しました');
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        throw new Error('保存に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchApiKeys();
    fetchModels();
  }, [fetchSettings, fetchApiKeys, fetchModels]);

  const saveApiKey = async (providerKey: string) => {
    const state = providerStates[providerKey];
    if (!state.apiKeyInput.trim()) return;

    updateProviderState(providerKey, { isSaving: true });
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: state.apiKeyInput,
          provider: providerKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        updateProviderState(providerKey, {
          maskedApiKey: data.maskedKey,
          apiKeyInput: '',
          isEditing: false,
          showApiKey: false,
        });

        const provider = PROVIDERS.find((p) => p.key === providerKey);
        if (provider) {
          setSettings((prev) =>
            prev ? { ...prev, [provider.configuredField]: true } : prev,
          );
        }

        setSuccessMessage(`${provider?.label ?? 'API'}キーを保存しました`);
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.apiKeys);
        localStorage.removeItem(CACHE_KEYS.models);
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? '保存に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      updateProviderState(providerKey, { isSaving: false });
    }
  };

  const deleteApiKey = async (providerKey: string) => {
    const provider = PROVIDERS.find((p) => p.key === providerKey);
    if (!confirm(`${provider?.label ?? 'API'}キーを削除してもよろしいですか？`))
      return;

    updateProviderState(providerKey, { isSaving: true });
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/settings/api-key?provider=${providerKey}`,
        { method: 'DELETE' },
      );

      if (res.ok) {
        updateProviderState(providerKey, {
          maskedApiKey: null,
          apiKeyInput: '',
          isEditing: false,
        });

        if (provider) {
          setSettings((prev) =>
            prev ? { ...prev, [provider.configuredField]: false } : prev,
          );
        }

        setSuccessMessage(`${provider?.label ?? 'API'}キーを削除しました`);
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.apiKeys);
        localStorage.removeItem(CACHE_KEYS.models);
      } else {
        throw new Error('削除に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      updateProviderState(providerKey, { isSaving: false });
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Settings className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            設定
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            アプリケーションの動作を管理
          </p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* 使用制限グラフ */}
        <UsageRateLimitGraph />

        {/* API設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-zinc-400" />
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                API設定
              </h2>
            </div>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {PROVIDERS.map((provider) => {
              const state = providerStates[provider.key];
              const isConfigured = !!(settings?.[provider.configuredField] as
                | boolean
                | undefined);

              return (
                <div key={provider.key} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${provider.iconColor}`}
                      >
                        <provider.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                          {provider.label}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                          {provider.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isConfigured ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium">
                          <CheckCircle className="w-4 h-4" />
                          設定済み
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-medium">
                          <AlertCircle className="w-4 h-4" />
                          未設定
                        </span>
                      )}
                    </div>
                  </div>

                  {/* APIキーが設定済みの場合 */}
                  {isConfigured && state.maskedApiKey && !state.isEditing && (
                    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
                            現在のAPIキー
                          </p>
                          <code className="block px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-sm font-mono truncate">
                            {state.maskedApiKey}
                          </code>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() =>
                              updateProviderState(provider.key, {
                                isEditing: true,
                              })
                            }
                            className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                          >
                            変更
                          </button>
                          <button
                            onClick={() => deleteApiKey(provider.key)}
                            disabled={state.isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* モデル選択 */}
                  {isConfigured && availableModels[provider.key] && (
                    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <label
                        htmlFor={`model-${provider.key}`}
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
                      >
                        デフォルトモデル
                      </label>
                      <div className="relative">
                        <select
                          id={`model-${provider.key}`}
                          value={
                            (settings?.[provider.modelField] as
                              | string
                              | null
                              | undefined) ?? ''
                          }
                          onChange={(e) =>
                            saveModel(provider.key, e.target.value)
                          }
                          className="w-full appearance-none px-4 py-2.5 pr-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all text-zinc-900 dark:text-zinc-100"
                        >
                          <option value="">選択してください</option>
                          {availableModels[provider.key].map((model) => (
                            <option key={model.value} value={model.value}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                      </div>
                    </div>
                  )}

                  {/* APIキー入力フォーム（未設定または編集中の場合） */}
                  {(!isConfigured || state.isEditing) && (
                    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg space-y-4">
                      <div>
                        <label
                          htmlFor={`apiKey-${provider.key}`}
                          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
                        >
                          APIキー
                        </label>
                        <div className="relative">
                          <input
                            type={state.showApiKey ? 'text' : 'password'}
                            id={`apiKey-${provider.key}`}
                            value={state.apiKeyInput}
                            onChange={(e) =>
                              updateProviderState(provider.key, {
                                apiKeyInput: e.target.value,
                              })
                            }
                            placeholder={provider.placeholder}
                            className="w-full px-4 py-2.5 pr-12 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateProviderState(provider.key, {
                                showApiKey: !state.showApiKey,
                              })
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            {state.showApiKey ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <a
                          href={provider.consoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          {provider.consoleName} でAPIキーを取得
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <div className="flex items-center gap-2">
                          {state.isEditing && (
                            <button
                              onClick={() => {
                                updateProviderState(provider.key, {
                                  isEditing: false,
                                  apiKeyInput: '',
                                  showApiKey: false,
                                });
                              }}
                              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            >
                              キャンセル
                            </button>
                          )}
                          <button
                            onClick={() => saveApiKey(provider.key)}
                            disabled={
                              !state.apiKeyInput.trim() || state.isSaving
                            }
                            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {state.isSaving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            保存
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* デフォルトAIプロバイダー設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  デフォルトAIプロバイダー
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  フローティングAIやタスク分析で使用するAIを選択
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['claude', 'chatgpt', 'gemini'] as ApiProvider[]).map((p) => {
                const provider = PROVIDERS.find((pr) => pr.key === p);
                const configField = provider?.configuredField;
                const isConfigured = !!(
                  configField && settings?.[configField as keyof UserSettings]
                );
                const isSelected = settings?.defaultAiProvider === p;

                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (isConfigured) saveDefaultProvider(p);
                    }}
                    disabled={!isConfigured}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                        : isConfigured
                          ? 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                          : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle className="w-5 h-5 text-violet-500" />
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      {provider && (
                        <div
                          className={`p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${provider.iconColor}`}
                        >
                          <provider.icon className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <h3
                          className={`font-medium text-sm ${
                            isSelected
                              ? 'text-violet-700 dark:text-violet-300'
                              : isConfigured
                                ? 'text-zinc-900 dark:text-zinc-100'
                                : 'text-zinc-400 dark:text-zinc-600'
                          }`}
                        >
                          {PROVIDER_LABELS[p]}
                        </h3>
                        <p
                          className={`text-xs mt-1 ${
                            isSelected
                              ? 'text-violet-500 dark:text-violet-400'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {PROVIDER_DESCRIPTIONS[p]}
                        </p>
                        {!isConfigured && (
                          <p className="text-xs text-amber-500 mt-2">
                            APIキー未設定
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
