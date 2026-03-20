/**
 * DeveloperModeSettingsPage
 *
 * Top-level page for developer mode settings.
 * Delegates state management to useDeveloperModeSettings and renders
 * individual settings cards for each feature group.
 */

'use client';

import { Bot, AlertCircle, Bug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAnalysisPanel } from '@/feature/developer-mode/components/ErrorAnalysisPanel';
import { useErrorCapture } from '@/feature/developer-mode/hooks/useErrorCapture';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createLogger } from '@/lib/logger';
import { useDeveloperModeSettings } from './hooks/useDeveloperModeSettings';
import { AiAssistantSettingsCard } from './components/AiAssistantSettingsCard';
import { TaskCreationSettingsCard } from './components/TaskCreationSettingsCard';
import { AutoResumeSettingsCard } from './components/AutoResumeSettingsCard';
import { WorkflowConfigCard } from './components/WorkflowConfigCard';

const logger = createLogger('DeveloperModePage');

export default function DeveloperModeSettingsPage() {
  const t = useTranslations('settings');
  const {
    settings,
    isLoading,
    isSaving,
    isSavingAutoResume,
    error,
    localDelay,
    updateSettings,
    toggleAutoResume,
    handleDelayChange,
    handleDelayBlur,
  } = useDeveloperModeSettings();

  const { manualCaptureError } = useErrorCapture({
    captureConsoleErrors: true,
    captureUnhandledRejections: true,
    captureNetworkErrors: true,
    onError: (err) => {
      logger.debug('Error captured:', err);
    },
  });

  void manualCaptureError;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Bot className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('devModeTitle')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('devModeSubtitle')}
          </p>
        </div>
      </div>

      <Tabs defaultValue="ai-settings" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ai-settings" className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            {t('devAiSettings')}
          </TabsTrigger>
          <TabsTrigger
            value="error-analysis"
            className="flex items-center gap-2"
          >
            <Bug className="w-4 h-4" />
            {t('devErrorAnalysis')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai-settings" className="mt-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="space-y-6">
            <AiAssistantSettingsCard
              settings={settings}
              isSaving={isSaving}
              onUpdateSettings={updateSettings}
            />
          </div>

          <TaskCreationSettingsCard
            settings={settings}
            isSaving={isSaving}
            localDelay={localDelay}
            onUpdateSettings={updateSettings}
            onDelayChange={handleDelayChange}
            onDelayBlur={handleDelayBlur}
          />

          <AutoResumeSettingsCard
            settings={settings}
            isSaving={isSavingAutoResume}
            onToggle={toggleAutoResume}
          />

          <WorkflowConfigCard
            settings={settings}
            isSaving={isSaving}
            onUpdateSettings={updateSettings}
          />
        </TabsContent>

        <TabsContent value="error-analysis" className="mt-6">
          <ErrorAnalysisPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
