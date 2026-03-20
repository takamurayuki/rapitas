/**
 * SettingsPage
 *
 * Next.js page entry point for /settings.
 * Delegates all data fetching to useSettingsData and rendering to sub-components.
 */
'use client';

import { useTranslations } from 'next-intl';
import { Settings, AlertCircle, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/utils/api';
import { useSettingsData } from './_hooks/useSettingsData';
import { ApiKeySection } from './_components/ApiKeySection';
import { DefaultProviderSection } from './_components/DefaultProviderSection';
import { LocalLlmSection } from './_components/LocalLlmSection';
import { DevToolsSection } from './_components/DevToolsSection';

function SettingsPage() {
  const t = useTranslations('settings');
  const {
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
  } = useSettingsData();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
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

      {/* Global error banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Global success banner */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <ApiKeySection
          settings={settings}
          availableModels={availableModels}
          providerStates={providerStates}
          onUpdateProviderState={updateProviderState}
          onSaveApiKey={saveApiKey}
          onDeleteApiKey={deleteApiKey}
          onSaveModel={saveModel}
        />

        <DefaultProviderSection
          settings={settings}
          onSaveDefaultProvider={saveDefaultProvider}
        />

        <LocalLlmSection
          settings={settings}
          localLlmStatus={localLlmStatus}
          localLlmLoading={localLlmLoading}
          downloadProgress={downloadProgress}
          ollamaUrlInput={ollamaUrlInput}
          onOllamaUrlChange={setOllamaUrlInput}
          onTestConnection={handleTestConnection}
          onDownloadModel={handleDownloadModel}
          onDeleteModel={async () => {
            await fetch(`${API_BASE_URL}/local-llm/model`, { method: 'DELETE' });
            fetchLocalLlmStatus();
          }}
          onSaveLocalLlmSettings={saveLocalLlmSettings}
        />

        <DevToolsSection />
      </div>
    </div>
  );
}

// NOTE: requireAuth wraps the page to ensure unauthenticated users are redirected.
export default requireAuth(SettingsPage);
