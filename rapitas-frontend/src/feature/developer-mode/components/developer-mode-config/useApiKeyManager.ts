'use client';

/**
 * useApiKeyManager
 *
 * Manages API key state for all supported providers: fetching status,
 * client-side validation, saving, and deleting keys.
 * Does not handle agent configuration.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { ApiProvider, ApiKeyStatusMap } from './types';
import { API_KEY_PROVIDERS } from './types';

const logger = createLogger('useApiKeyManager');

/**
 * Provides state and actions for all API key operations in the config modal.
 *
 * @returns API key statuses, form state, and I/O action callbacks.
 */
export function useApiKeyManager() {
  const t = useTranslations('devMode.apiKeyManager');
  const tCommon = useTranslations('common');
  const [apiKeyStatuses, setApiKeyStatuses] = useState<ApiKeyStatusMap>({
    claude: { configured: false, maskedKey: null },
    chatgpt: { configured: false, maskedKey: null },
    gemini: { configured: false, maskedKey: null },
    ollama: { configured: false, maskedKey: null },
  });
  const [isLoadingApiKeys, setIsLoadingApiKeys] = useState(false);
  const [apiKeyProvider, setApiKeyProvider] = useState<ApiProvider>('claude');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyValidationError, setApiKeyValidationError] = useState<string | null>(null);
  const [apiKeySuccessMessage, setApiKeySuccessMessage] = useState<string | null>(null);

  /**
   * Fetches the configured/masked API key status for all providers.
   */
  const fetchAllApiKeys = async () => {
    setIsLoadingApiKeys(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-keys`);
      if (res.ok) {
        const data = await res.json();
        setApiKeyStatuses({
          claude: data.claude ?? { configured: false, maskedKey: null },
          chatgpt: data.chatgpt ?? { configured: false, maskedKey: null },
          gemini: data.gemini ?? { configured: false, maskedKey: null },
          ollama: data.ollama ?? { configured: false, maskedKey: null },
        });
      }
    } catch (err) {
      logger.error('APIキー情報の取得に失敗:', err);
    } finally {
      setIsLoadingApiKeys(false);
    }
  };

  /**
   * Client-side validation before sending the API key to the backend.
   * Each provider has its own prefix requirement.
   *
   * @param apiKey - Raw key string entered by the user. / ユーザーが入力した生のキー文字列
   * @param provider - Target API provider. / 対象のAPIプロバイダー
   * @returns Validation result with optional error message. / バリデーション結果
   */
  const validateApiKeyForProvider = (
    apiKey: string,
    provider: ApiProvider,
  ): { valid: boolean; error?: string } => {
    const trimmed = apiKey.trim();
    if (!trimmed) return { valid: false, error: t('emptyKey') };
    if (trimmed.length < 10)
      return {
        valid: false,
        error: t('tooShort'),
      };
    switch (provider) {
      case 'claude':
        if (!trimmed.startsWith('sk-ant-api'))
          return {
            valid: false,
            error: t('claudePrefix'),
          };
        break;
      case 'chatgpt':
        if (!trimmed.startsWith('sk-'))
          return {
            valid: false,
            error: t('openaiPrefix'),
          };
        if (trimmed.startsWith('sk-ant-api'))
          return {
            valid: false,
            error: t('claudeKeyForOpenai'),
          };
        break;
      case 'gemini':
        if (!trimmed.startsWith('AIza'))
          return {
            valid: false,
            error: t('geminiPrefix'),
          };
        break;
    }
    return { valid: true };
  };

  /**
   * Validates then persists the currently entered API key for the selected
   * provider to the backend.
   */
  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    const validation = validateApiKeyForProvider(apiKeyInput, apiKeyProvider);
    if (!validation.valid) {
      setApiKeyValidationError(validation.error ?? null);
      return;
    }
    setIsSavingApiKey(true);
    setApiKeyValidationError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput, provider: apiKeyProvider }),
      });
      if (res.ok) {
        const data = await res.json();
        setApiKeyStatuses((prev) => ({
          ...prev,
          [apiKeyProvider]: { configured: true, maskedKey: data.maskedKey },
        }));
        setApiKeyInput('');
        setShowApiKey(false);
        setApiKeySuccessMessage(
          t('savedKeyMessage', {
            provider: API_KEY_PROVIDERS.find((p) => p.value === apiKeyProvider)?.label ?? '',
          }),
        );
        setTimeout(() => setApiKeySuccessMessage(null), 3000);
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? tCommon('saveFailed'));
      }
    } catch (err) {
      setApiKeyValidationError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setIsSavingApiKey(false);
    }
  };

  /**
   * Deletes the stored API key for the given provider.
   *
   * @param provider - Provider whose key should be removed. / 削除対象プロバイダー
   */
  const deleteApiKey = async (provider: ApiProvider) => {
    setIsSavingApiKey(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key?provider=${provider}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setApiKeyStatuses((prev) => ({
          ...prev,
          [provider]: { configured: false, maskedKey: null },
        }));
        setApiKeySuccessMessage(t('deletedMessage'));
        setTimeout(() => setApiKeySuccessMessage(null), 3000);
      }
    } catch (err) {
      logger.error('APIキー削除に失敗:', err);
    } finally {
      setIsSavingApiKey(false);
    }
  };

  return {
    apiKeyStatuses,
    isLoadingApiKeys,
    fetchAllApiKeys,
    apiKeyProvider,
    setApiKeyProvider,
    apiKeyInput,
    setApiKeyInput,
    showApiKey,
    setShowApiKey,
    isSavingApiKey,
    apiKeyValidationError,
    setApiKeyValidationError,
    apiKeySuccessMessage,
    saveApiKey,
    deleteApiKey,
  };
}
