'use client';
// AgentSettingsClient

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAgentSettings } from './useAgentSettings';
import { PROVIDER_CONFIGS } from './ProviderConfigs';
import {
  BasicSettingsSection,
  ApiKeySection,
  ClaudeCodeInfoSection,
  ConnectionTestSection,
  SettingsActionBar,
} from './AgentSettingsSections';

export default function AgentSettingsClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('agents');

  const {
    agent,
    loading,
    saving,
    testing,
    testResult,
    showApiKey,
    setShowApiKey,
    error,
    successMessage,
    availableModels,
    endpoint,
    modelId,
    setModelId,
    apiKey,
    fieldErrors,
    updateField,
    setEndpoint,
    setApiKey,
    handleSave,
    handleDeleteApiKey,
    handleTestConnection,
    handleDelete,
  } = useAgentSettings(id);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-5rem)] bg-background">
        <XCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-zinc-600 dark:text-zinc-400">{error || t('agentNotFound')}</p>
        <Link href="/agents" className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">
          {t('backToAgentList')}
        </Link>
      </div>
    );
  }

  const providerConfig = PROVIDER_CONFIGS[agent.agentType] || PROVIDER_CONFIGS['custom'];

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/agents"
            className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${providerConfig.color}`}>
              {providerConfig.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{agent.name}</h1>
              <p className="text-zinc-500 dark:text-zinc-400">
                {t('settingsFor', {
                  name:
                    providerConfig.name === 'customProvider' ? t('custom') : providerConfig.name,
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-green-600 dark:text-green-400">{successMessage}</p>
          </div>
        )}

        <BasicSettingsSection
          agent={agent}
          providerConfig={providerConfig}
          availableModels={availableModels}
          modelId={modelId}
          endpoint={endpoint}
          fieldErrors={fieldErrors}
          onModelChange={setModelId}
          onEndpointChange={(v) => updateField('endpoint', v, setEndpoint)}
        />

        <ApiKeySection
          agent={agent}
          providerConfig={providerConfig}
          apiKey={apiKey}
          showApiKey={showApiKey}
          fieldErrors={fieldErrors}
          onApiKeyChange={(v) => updateField('apiKey', v, setApiKey)}
          onToggleShow={() => setShowApiKey(!showApiKey)}
          onDeleteApiKey={handleDeleteApiKey}
        />

        <ClaudeCodeInfoSection agentType={agent.agentType} />

        <ConnectionTestSection
          testing={testing}
          testResult={testResult}
          onTest={handleTestConnection}
        />

        <SettingsActionBar saving={saving} onSave={handleSave} onDelete={handleDelete} />
      </div>
    </div>
  );
}
