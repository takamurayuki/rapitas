'use client';
// useSettingsData — central hook for the settings page.

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings, ApiProvider } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { CACHE_KEYS, getCachedData, setCachedData } from './settings-cache';

const logger = createLogger('useSettingsData');

export type ModelOption = { value: string; label: string };

export type ProviderState = {
  apiKeyInput: string;
  showApiKey: boolean;
  maskedApiKey: string | null;
  isEditing: boolean;
  isSaving: boolean;
};

export const INITIAL_PROVIDER_STATE: ProviderState = {
  apiKeyInput: '',
  showApiKey: false,
  maskedApiKey: null,
  isEditing: false,
  isSaving: false,
};

export const PROVIDER_KEYS = ['claude', 'chatgpt', 'gemini'] as const;

// ────────────────────────────────────────────────────────────────────────────
// Fetch Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch with stale-while-revalidate pattern.
 *
 * @param url - API endpoint URL
 * @param cacheKey - Cache key for localStorage
 * @param onData - Callback when data is received (from cache or fresh)
 */
async function fetchWithSWR<T>(
  url: string,
  cacheKey: string,
  onData: (data: T) => void,
): Promise<{ cached: boolean; data: T | null }> {
  const cached = getCachedData<T>(cacheKey);
  if (cached) {
    onData(cached);
    // Background revalidate
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          onData(data);
          setCachedData(cacheKey, data);
        }
      })
      .catch(() => {
        /* ignore background errors */
      });
    return { cached: true, data: cached };
  }

  const res = await fetch(url);
  if (res.ok) {
    const data = await res.json();
    onData(data);
    setCachedData(cacheKey, data);
    return { cached: false, data };
  }
  return { cached: false, data: null };
}

/**
 * Make an API request with standard error handling.
 *
 * @returns Response data on success, throws on failure
 */
async function apiRequest<T>(url: string, options: RequestInit, errorMessage: string): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error ?? errorMessage);
  }
  return res.json();
}

// ────────────────────────────────────────────────────────────────────────────
// Download Progress Polling
// ────────────────────────────────────────────────────────────────────────────

type DownloadProgressState = {
  status: string;
  progress: number;
  downloadedMB: number;
  totalMB: number;
};

/**
 * Poll download progress until completed or error.
 */
function pollDownloadProgress(
  onProgress: (progress: DownloadProgressState) => void,
  onComplete: (success: boolean) => void,
): () => void {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/local-llm/download-progress`);
      if (res.ok) {
        const progress = await res.json();
        onProgress(progress);
        if (progress.status === 'completed' || progress.status === 'error') {
          clearInterval(interval);
          onComplete(progress.status === 'completed');
        }
      }
    } catch {
      clearInterval(interval);
      onComplete(false);
    }
  }, 1000);

  return () => clearInterval(interval);
}

/**
 * Central hook for the settings page.
 *
 * @returns All state and handlers required by the settings page components.
 */
export function useSettingsData() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, ModelOption[]>>({});
  const [ollamaUrlInput, setOllamaUrlInput] = useState('');

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

  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>(() => {
    const states: Record<string, ProviderState> = {};
    for (const key of PROVIDER_KEYS) {
      states[key] = { ...INITIAL_PROVIDER_STATE };
    }
    return states;
  });

  const updateProviderState = (providerKey: string, updates: Partial<ProviderState>) => {
    setProviderStates((prev) => ({
      ...prev,
      [providerKey]: { ...prev[providerKey], ...updates },
    }));
  };

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const { cached, data } = await fetchWithSWR<UserSettings>(
        `${API_BASE_URL}/settings`,
        CACHE_KEYS.settings,
        (data) => {
          setSettings(data);
          if (data.ollamaUrl) setOllamaUrlInput(data.ollamaUrl);
        },
      );
      if (cached) setIsLoading(false);
    } catch {
      setError(t('fetchFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const fetchApiKeys = useCallback(async () => {
    type ApiKeyData = Record<string, { configured: boolean; maskedKey: string | null }>;
    const applyApiKeyData = (data: ApiKeyData) => {
      for (const [provider, info] of Object.entries(data)) {
        if (info.configured && info.maskedKey) {
          updateProviderState(provider, { maskedApiKey: info.maskedKey });
        }
      }
    };

    try {
      await fetchWithSWR<ApiKeyData>(
        `${API_BASE_URL}/settings/api-keys`,
        CACHE_KEYS.apiKeys,
        applyApiKeyData,
      );
    } catch (err) {
      logger.error(t('apiKeysFetchFailed'), err);
    }
  }, [t]);

  const fetchModels = useCallback(async () => {
    try {
      await fetchWithSWR<Record<string, ModelOption[]>>(
        `${API_BASE_URL}/settings/models`,
        CACHE_KEYS.models,
        setAvailableModels,
      );
    } catch (err) {
      logger.error(t('modelsFetchFailed'), err);
    }
  }, [t]);

  const fetchLocalLlmStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/local-llm/status`);
      if (res.ok) setLocalLlmStatus(await res.json());
    } catch {
      // NOTE: Silently ignored — endpoint may not exist in all deployment configs.
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchApiKeys();
    fetchModels();
    fetchLocalLlmStatus();
  }, [fetchSettings, fetchApiKeys, fetchModels, fetchLocalLlmStatus]);

  /**
   * Saves an API key for the given provider.
   *
   * @param providerKey - Provider identifier (claude, chatgpt, gemini).
   */
  const saveApiKey = async (providerKey: string, configuredField: keyof UserSettings) => {
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
        setSettings((prev) => (prev ? { ...prev, [configuredField]: true } : prev));
        showSuccess(t('keySaved'));
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

  /**
   * Deletes the stored API key for the given provider.
   *
   * @param providerKey - Provider identifier.
   * @param configuredField - Settings field to clear on success.
   */
  const deleteApiKey = async (providerKey: string, configuredField: keyof UserSettings) => {
    if (!confirm(t('confirmDeleteKey'))) return;
    updateProviderState(providerKey, { isSaving: true });
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key?provider=${providerKey}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        updateProviderState(providerKey, {
          maskedApiKey: null,
          apiKeyInput: '',
          isEditing: false,
        });
        setSettings((prev) => (prev ? { ...prev, [configuredField]: false } : prev));
        showSuccess(t('keyDeleted'));
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

  /**
   * Saves the selected default model for a provider.
   *
   * @param providerKey - Provider identifier.
   * @param modelField - Settings field to update.
   * @param model - Model identifier string.
   */
  const saveModel = async (providerKey: string, modelField: keyof UserSettings, model: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, provider: providerKey }),
      });
      if (res.ok) {
        setSettings((prev) => (prev ? { ...prev, [modelField]: model || null } : prev));
        showSuccess(t('modelSaved'));
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? t('modelSaveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    }
  };

  /**
   * Saves the default AI provider preference.
   *
   * @param provider - Selected provider.
   */
  const saveDefaultProvider = async (provider: ApiProvider) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAiProvider: provider }),
      });
      if (res.ok) {
        setSettings((prev) => (prev ? { ...prev, defaultAiProvider: provider } : prev));
        showSuccess(t('providerSaved'));
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        throw new Error(tc('saveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    }
  };

  /**
   * Triggers download of the local LLM model and polls for progress.
   */
  const handleDownloadModel = async () => {
    setLocalLlmLoading(true);
    try {
      await fetch(`${API_BASE_URL}/local-llm/download-model`, { method: 'POST' });
      pollDownloadProgress(setDownloadProgress, (success) => {
        setLocalLlmLoading(false);
        fetchLocalLlmStatus();
        if (success) showSuccess(t('localLlmDownloaded'));
      });
    } catch {
      setLocalLlmLoading(false);
      setError(t('localLlmTestFailed'));
    }
  };

  /**
   * Tests connectivity to the configured local LLM endpoint.
   */
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
        showSuccess(t('localLlmTestSuccess'));
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

  /**
   * Saves arbitrary local LLM settings fields.
   *
   * @param updates - Partial settings object to PATCH.
   */
  const saveLocalLlmSettings = async (updates: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setSettings((prev) => (prev ? ({ ...prev, ...updates } as UserSettings) : prev));
        showSuccess(t('localLlmSaved'));
        localStorage.removeItem(CACHE_KEYS.settings);
      } else {
        throw new Error(tc('saveFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('errorOccurred'));
    }
  };

  return {
    settings,
    isLoading,
    error,
    successMessage,
    availableModels,
    ollamaUrlInput,
    setOllamaUrlInput,
    localLlmStatus,
    localLlmLoading,
    downloadProgress,
    providerStates,
    updateProviderState,
    fetchLocalLlmStatus,
    saveApiKey,
    deleteApiKey,
    saveModel,
    saveDefaultProvider,
    handleDownloadModel,
    handleTestConnection,
    saveLocalLlmSettings,
  };
}
