'use client';
// AgentSettingsSections

import {
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Save,
  TestTube2,
  Info,
  Terminal,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AgentConfig, ModelOption } from './agent-settings-types';
import type { ProviderConfig } from './ProviderConfigs';

// Re-export so callers only need one import location
export { ApiKeySection } from './ApiKeySection';

// ─── BasicSettingsSection ────────────────────────────────────────────────────

type BasicSettingsSectionProps = {
  agent: AgentConfig;
  providerConfig: ProviderConfig;
  availableModels: ModelOption[];
  modelId: string;
  endpoint: string;
  fieldErrors: Record<string, string | null>;
  onModelChange: (v: string) => void;
  onEndpointChange: (v: string) => void;
};

/**
 * Renders the model selector and optional endpoint input.
 *
 * @param props - BasicSettingsSectionProps
 */
export function BasicSettingsSection({
  agent,
  providerConfig,
  availableModels,
  modelId,
  endpoint,
  fieldErrors,
  onModelChange,
  onEndpointChange,
}: BasicSettingsSectionProps) {
  const t = useTranslations('agents');

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5" />
        {t('basicSettings')}
      </h2>

      <div className="space-y-4">
        {availableModels.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('model')}
            </label>
            <select
              value={modelId}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">{t('selectModel')}</option>
              {availableModels.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}{' '}
                  {model.description ? `- ${model.description}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {providerConfig.endpointEditable && (
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('settingsEndpoint')}
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => onEndpointChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:border-transparent ${
                fieldErrors.endpoint
                  ? 'border-red-400 dark:border-red-600 focus:ring-red-500'
                  : 'border-zinc-300 dark:border-zinc-600 focus:ring-indigo-500'
              }`}
              placeholder={
                providerConfig.defaultEndpoint || 'https://api.example.com/v1'
              }
            />
            {fieldErrors.endpoint && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                {fieldErrors.endpoint}
              </p>
            )}
            {!fieldErrors.endpoint && agent.agentType === 'azure-openai' && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                例:
                https://your-resource.openai.azure.com/openai/deployments/your-deployment
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ClaudeCodeInfoSection ───────────────────────────────────────────────────

type ClaudeCodeInfoSectionProps = {
  agentType: string;
};

/**
 * Renders a notice for the Claude Code local CLI agent type.
 *
 * @param props - ClaudeCodeInfoSectionProps
 */
export function ClaudeCodeInfoSection({
  agentType,
}: ClaudeCodeInfoSectionProps) {
  const t = useTranslations('agents');

  if (agentType !== 'claude-code') return null;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Terminal className="w-5 h-5" />
        Claude Code CLI
      </h2>
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <div className="flex gap-2">
          <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium mb-1">{t('localCliMode')}</p>
            <p className="text-xs">{t('localCliDescription')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ConnectionTestSection ───────────────────────────────────────────────────

type ConnectionTestSectionProps = {
  testing: boolean;
  testResult: { success: boolean; message: string } | null;
  onTest: () => void;
};

/**
 * Renders the connection test button and its result.
 *
 * @param props - ConnectionTestSectionProps
 */
export function ConnectionTestSection({
  testing,
  testResult,
  onTest,
}: ConnectionTestSectionProps) {
  const t = useTranslations('agents');

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <TestTube2 className="w-5 h-5" />
        {t('connectionTest')}
      </h2>

      <div className="flex items-center gap-4">
        <button
          onClick={onTest}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          {testing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <TestTube2 className="w-4 h-4" />
          )}
          {t('testConnection')}
        </button>

        {testResult && (
          <div
            className={`flex items-center gap-2 ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span className="text-sm">{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SettingsActionBar ───────────────────────────────────────────────────────

type SettingsActionBarProps = {
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
};

/**
 * Renders the bottom action bar with save and delete buttons.
 *
 * @param props - SettingsActionBarProps
 */
export function SettingsActionBar({
  saving,
  onSave,
  onDelete,
}: SettingsActionBarProps) {
  const tc = useTranslations('common');

  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onDelete}
        className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        {tc('delete')}
      </button>

      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {tc('save')}
      </button>
    </div>
  );
}
