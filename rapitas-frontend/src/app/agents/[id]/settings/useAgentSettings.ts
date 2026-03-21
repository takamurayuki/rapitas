/**
 * useAgentSettings
 *
 * Custom hook encapsulating state, data-fetching, and mutation coordination
 * for the agent settings page. Delegates API calls to agentSettingsApi.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { validateUrl, validateApiKey, type ValidationResult } from '@/utils/validation';
import { createLogger } from '@/lib/logger';
import type { AgentConfig, ModelOption } from './agent-settings-types';
import { saveAgentSettings, deleteAgentApiKey, deleteAgent } from './agent-settings-api';

export type { AgentConfig, ModelOption };

const logger = createLogger('useAgentSettings');

/**
 * Manages all agent settings state and side effects.
 *
 * @param id - Agent ID from route params / ルートパラメータのエージェントID
 * @returns State values and handler functions for the settings form
 */
export function useAgentSettings(id: string) {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const router = useRouter();

  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);

  const [endpoint, setEndpoint] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const fetchModels = useCallback(async (agentType: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/models?type=${agentType}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models || []);
      }
    } catch (err) {
      logger.error('Failed to fetch models:', err);
    }
  }, []);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}`);
      if (res.ok) {
        const data = await res.json();
        setAgent(data);
        setEndpoint(data.endpoint || '');
        setModelId(data.modelId || '');
        setCapabilities(data.capabilities || {});
        fetchModels(data.agentType);
      } else {
        setError(t('agentNotFound'));
      }
    } catch (err) {
      logger.error('Failed to fetch agent:', err);
      setError(t('agentFetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, fetchModels, t]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  const validateField = useCallback(
    (field: string, value: string): string | null => {
      let result: ValidationResult;
      switch (field) {
        case 'endpoint':
          result = validateUrl(value, t('settingsEndpoint'),
            agent?.agentType === 'custom' || agent?.agentType === 'azure-openai');
          return result.valid ? null : (result.error ?? null);
        case 'apiKey':
          if (!value.trim()) return null;
          result = validateApiKey(value, agent?.agentType);
          return result.valid ? null : (result.error ?? null);
        default:
          return null;
      }
    },
    [agent?.agentType, t],
  );

  const updateField = useCallback(
    (field: string, value: string, setter: (v: string) => void) => {
      setter(value);
      setFieldErrors((prev) => ({
        ...prev,
        [field]: value.trim() ? validateField(field, value) : null,
      }));
    },
    [validateField],
  );

  const handleSave = async () => {
    if (!agent) return;
    setError('');
    setSuccessMessage('');
    setSaving(true);

    try {
      const result = await saveAgentSettings({
        id, agentType: agent.agentType, endpoint, modelId, apiKey,
        capabilities, settingsEndpointLabel: t('settingsEndpoint'),
      });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        setError(result.message);
        return;
      }

      setFieldErrors({});
      setSuccessMessage(t('settingsSaved'));
      setApiKey('');
      await fetchAgent();
      // NOTE: Auto-clear success banner after 3 seconds to avoid stale feedback.
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? t(err.message as 'settingsSaveFailed') : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (!confirm(t('confirmDeleteApiKey'))) return;
    setError('');
    setSuccessMessage('');
    try {
      await deleteAgentApiKey(id);
      setSuccessMessage(t('apiKeyDeleted'));
      await fetchAgent();
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? t(err.message as 'apiKeyDeleteFailed') : tc('deleteFailed'));
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? t('connectionSuccess') : t('connectionFailed')),
      });
    } catch (err) {
      logger.error('Failed to test connection:', err);
      setTestResult({ success: false, message: t('connectionTestFailed') });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('confirmDeleteAgent'))) return;
    try {
      await deleteAgent(id);
      router.push('/agents');
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('deleteFailed'));
    }
  };

  return {
    agent, loading, saving, testing, testResult, showApiKey, setShowApiKey,
    error, successMessage, availableModels, endpoint, modelId, setModelId,
    apiKey, capabilities, fieldErrors, updateField, setEndpoint, setApiKey,
    handleSave, handleDeleteApiKey, handleTestConnection, handleDelete,
  };
}
