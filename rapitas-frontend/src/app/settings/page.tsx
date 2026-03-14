'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
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
  Terminal,
  ChevronRight,
} from 'lucide-react';
import type { UserSettings, ApiProvider } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import {
  ClaudeIcon,
  ChatGPTIcon,
  GeminiIcon,
} from '@/components/icons/ProviderIcons';
import { requireAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SettingsPage');

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const PROVIDER_DESCRIPTIONS: Record<ApiProvider, string> = {
  claude: 'Anthropic Claude API',
  chatgpt: 'OpenAI ChatGPT / GPT API',
  gemini: 'Google Gemini API',
  ollama: 'Local LLM (Ollama / llama-server)',
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
    label: 'claudeApiKey',
    description: 'claudeDescription',
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
    label: 'openaiApiKey',
    description: 'openaiDescription',
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
    label: 'geminiApiKey',
    description: 'geminiDescription',
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
    logger.error('Failed to cache data:', error);
  }
}

function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<
    Record<string, ModelOption[]>
  >({});

  // Local LLM state
  const [localLlmStatus, setLocalLlmStatus] = useState<{
    available: boolean;
    source: string;
    model: string;
    models: string[];
    modelDownloaded: boolean;
  } | null>(null);
  const [localLlmLoading, setLocalLlmLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    status: string;
    progress: number;
    downloadedMB: number;
    totalMB: number;
  } | null>(null);
  const [ollamaUrlInput, setOllamaUrlInput] = useState('');

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
        if (data.ollamaUrl) setOllamaUrlInput(data.ollamaUrl);
      }
    } catch {
      setError(t('fetchFailed'));
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
      logger.error(t('apiKeysFetchFailed'), err);
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
      logger.error(t('modelsFetchFailed'), err);
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
        setSuccessMessage(t('modelSaved'));
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? t('modelSaveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
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
        setSuccessMessage(t('providerSaved'));
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        throw new Error(tc('saveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    }
  };

  // Local LLM functions
  const fetchLocalLlmStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/local-llm/status`);
      if (res.ok) {
        const data = await res.json();
        setLocalLlmStatus(data);
      }
    } catch {
      // ignore - server may not support this endpoint yet
    }
  }, []);

  const handleDownloadModel = async () => {
    setLocalLlmLoading(true);
    try {
      await fetch(`${API_BASE_URL}/local-llm/download-model`, {
        method: 'POST',
      });
      // Poll progress
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(
            `${API_BASE_URL}/local-llm/download-progress`,
          );
          if (res.ok) {
            const progress = await res.json();
            setDownloadProgress(progress);
            if (
              progress.status === 'completed' ||
              progress.status === 'error'
            ) {
              clearInterval(pollInterval);
              setLocalLlmLoading(false);
              fetchLocalLlmStatus();
              if (progress.status === 'completed') {
                setSuccessMessage(t('localLlmDownloaded'));
                setTimeout(() => setSuccessMessage(null), 3000);
              }
            }
          }
        } catch {
          clearInterval(pollInterval);
          setLocalLlmLoading(false);
        }
      }, 1000);
    } catch {
      setLocalLlmLoading(false);
      setError(t('localLlmTestFailed'));
    }
  };

  const handleTestConnection = async () => {
    setLocalLlmLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/local-llm/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ollamaUrlInput || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(t('localLlmTestSuccess'));
        setTimeout(() => setSuccessMessage(null), 3000);
        fetchLocalLlmStatus();
      } else {
        setError(data.message || t('localLlmTestFailed'));
      }
    } catch {
      setError(t('localLlmTestFailed'));
    } finally {
      setLocalLlmLoading(false);
    }
  };

  const saveLocalLlmSettings = async (updates: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? ({ ...prev, ...updates } as UserSettings) : prev,
        );
        setSuccessMessage(t('localLlmSaved'));
        setTimeout(() => setSuccessMessage(null), 3000);
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        throw new Error(tc('saveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchApiKeys();
    fetchModels();
    fetchLocalLlmStatus();
  }, [fetchSettings, fetchApiKeys, fetchModels, fetchLocalLlmStatus]);

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

        setSuccessMessage(t('keySaved'));
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.apiKeys);
        localStorage.removeItem(CACHE_KEYS.models);
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? tc('saveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    } finally {
      updateProviderState(providerKey, { isSaving: false });
    }
  };

  const deleteApiKey = async (providerKey: string) => {
    const provider = PROVIDERS.find((p) => p.key === providerKey);
    if (!confirm(t('confirmDeleteKey'))) return;

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

        setSuccessMessage(t('keyDeleted'));
        setTimeout(() => setSuccessMessage(null), 3000);
        // Clear cache to ensure fresh data
        localStorage.removeItem(CACHE_KEYS.apiKeys);
        localStorage.removeItem(CACHE_KEYS.models);
      } else {
        throw new Error(tc('deleteFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
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
            {t('title')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('subtitle')}
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
        {/* API設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-zinc-400" />
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                {t('apiConfig')}
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
                          {t(provider.label)}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                          {t(provider.description)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isConfigured ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium">
                          <CheckCircle className="w-4 h-4" />
                          {tc('configured')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-medium">
                          <AlertCircle className="w-4 h-4" />
                          {tc('notConfigured')}
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
                            {t('currentApiKey')}
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
                            {tc('change')}
                          </button>
                          <button
                            onClick={() => deleteApiKey(provider.key)}
                            disabled={state.isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            {tc('delete')}
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
                        {t('defaultModel')}
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
                          <option value="">{tc('select')}</option>
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
                          {t('apiKey')}
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
                          {provider.consoleName} {t('getApiKey')}
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
                              {tc('cancel')}
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
                            {tc('save')}
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
                  {t('defaultAiProvider')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('selectDefaultAi')}
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
                            {t('apiKeyNotConfigured')}
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

        {/* ローカルAI設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Terminal className="w-5 h-5 text-emerald-500" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('localLlmConfig')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('localLlmDescription')}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            {/* ステータス */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t('localLlmStatus')}:
                </span>
                {localLlmStatus?.available ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t('localLlmConnected')} ({localLlmStatus.source})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                    {t('localLlmDisconnected')}
                  </span>
                )}
              </div>
              <button
                onClick={handleTestConnection}
                disabled={localLlmLoading}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {localLlmLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  t('localLlmTestConnection')
                )}
              </button>
            </div>

            {/* Ollama URL */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('localLlmOllamaUrl')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ollamaUrlInput}
                  onChange={(e) => setOllamaUrlInput(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
                <button
                  onClick={() =>
                    saveLocalLlmSettings({ ollamaUrl: ollamaUrlInput })
                  }
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors"
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* モデル情報 */}
            {localLlmStatus?.available && localLlmStatus.models.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t('localLlmModel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {localLlmStatus.models.slice(0, 10).map((model) => (
                    <span
                      key={model}
                      className="px-2.5 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* モデルダウンロード (llama-serverフォールバック用) */}
            <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Qwen2.5-0.5B (Q4) — llama-server用
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Ollamaがない場合のフォールバックモデル (~400MB)
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    localLlmStatus?.modelDownloaded
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}
                >
                  {localLlmStatus?.modelDownloaded
                    ? t('localLlmDownloaded')
                    : t('localLlmNotDownloaded')}
                </span>
              </div>

              {downloadProgress?.status === 'downloading' && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    <span>{t('localLlmDownloading')}</span>
                    <span>
                      {downloadProgress.downloadedMB}MB /{' '}
                      {downloadProgress.totalMB}MB ({downloadProgress.progress}
                      %)
                    </span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                    <div
                      className="bg-violet-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress.progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-3">
                {!localLlmStatus?.modelDownloaded && (
                  <button
                    onClick={handleDownloadModel}
                    disabled={
                      localLlmLoading ||
                      downloadProgress?.status === 'downloading'
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >
                    {downloadProgress?.status === 'downloading'
                      ? t('localLlmDownloading')
                      : t('localLlmDownloadModel')}
                  </button>
                )}
                {localLlmStatus?.modelDownloaded && (
                  <button
                    onClick={async () => {
                      await fetch(`${API_BASE_URL}/local-llm/model`, {
                        method: 'DELETE',
                      });
                      fetchLocalLlmStatus();
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 inline mr-1" />
                    {t('localLlmDeleteModel')}
                  </button>
                )}
              </div>
            </div>

            {/* タイトル生成プロバイダー選択 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('titleGenerationProvider')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() =>
                    saveLocalLlmSettings({ titleGenerationProvider: 'ollama' })
                  }
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    !settings?.titleGenerationProvider ||
                    settings.titleGenerationProvider === 'ollama'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-emerald-300 dark:hover:border-emerald-700 bg-white dark:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {(!settings?.titleGenerationProvider ||
                      settings.titleGenerationProvider === 'ollama') && (
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    )}
                    <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {t('titleGenUseLocal')}
                    </h3>
                  </div>
                </button>
                <button
                  onClick={() =>
                    saveLocalLlmSettings({ titleGenerationProvider: 'default' })
                  }
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    settings?.titleGenerationProvider === 'default'
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {settings?.titleGenerationProvider === 'default' && (
                      <CheckCircle className="w-4 h-4 text-violet-500" />
                    )}
                    <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {t('titleGenUseDefault')}
                    </h3>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CLI管理ページへのリンク */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Terminal className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('devTools')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('cliSetup')}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <a
              href="/settings/cli-tools"
              className="block group p-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {t('cliManagement')}
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {t('cliDescription')}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// 認証が必要なコンポーネントとしてエクスポート
export default requireAuth(SettingsPage);
