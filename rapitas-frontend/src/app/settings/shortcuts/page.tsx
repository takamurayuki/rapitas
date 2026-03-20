/**
 * ShortcutSettingsPage
 *
 * Settings page for keyboard shortcut configuration.
 * Composes GlobalShortcutSection and InAppShortcutsSection with shared state
 * from useShortcutSettings. Renders a loading spinner while shortcuts are loading.
 */

'use client';

import { Keyboard, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useShortcutSettings } from './hooks/use-shortcut-settings';
import { GlobalShortcutSection } from './components/global-shortcut-section';
import { InAppShortcutsSection } from './components/in-app-shortcuts-section';

/**
 * Keyboard shortcut settings page.
 * Shows a loading spinner until the current global shortcut has been read from storage.
 */
export default function ShortcutSettingsPage() {
  const t = useTranslations('shortcuts');

  const {
    isTauriEnv,
    // Global shortcut
    currentGlobalShortcut,
    globalModifiers,
    globalKey,
    setGlobalKey,
    isLoadingGlobal,
    isSavingGlobal,
    globalMessage,
    isRecordingGlobal,
    setIsRecordingGlobal,
    newGlobalShortcut,
    hasGlobalChanges,
    toggleGlobalModifier,
    handleSaveGlobal,
    handleResetGlobal,
    // In-app shortcuts
    shortcuts,
    editingId,
    editBinding,
    isRecordingInApp,
    setIsRecordingInApp,
    inAppMessage,
    duplicateWarning,
    getDefault,
    startEditing,
    cancelEditing,
    handleSaveInApp,
    handleResetInApp,
    handleResetAll,
  } = useShortcutSettings();

  if (isLoadingGlobal) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex items-center justify-center w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
          <Keyboard className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t('description')}
          </p>
        </div>
      </div>

      <GlobalShortcutSection
        currentGlobalShortcut={currentGlobalShortcut}
        globalModifiers={globalModifiers}
        globalKey={globalKey}
        isRecordingGlobal={isRecordingGlobal}
        isSavingGlobal={isSavingGlobal}
        globalMessage={globalMessage}
        newGlobalShortcut={newGlobalShortcut}
        hasGlobalChanges={hasGlobalChanges}
        onToggleRecording={() => setIsRecordingGlobal(!isRecordingGlobal)}
        onToggleModifier={toggleGlobalModifier}
        onKeyChange={(key) => {
          setGlobalKey(key);
        }}
        onSave={handleSaveGlobal}
        onReset={handleResetGlobal}
      />

      <InAppShortcutsSection
        shortcuts={shortcuts}
        editingId={editingId}
        editBinding={editBinding}
        isRecordingInApp={isRecordingInApp}
        inAppMessage={inAppMessage}
        duplicateWarning={duplicateWarning}
        getDefault={getDefault}
        onStartEditing={startEditing}
        onCancelEditing={cancelEditing}
        onSaveInApp={handleSaveInApp}
        onResetInApp={handleResetInApp}
        onResetAll={handleResetAll}
        onToggleRecording={() => setIsRecordingInApp(!isRecordingInApp)}
      />

      {/* Info banner */}
      <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-200 dark:border-blue-800/30 p-4">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <p>{t('globalInfo')}</p>
            <p>{t('inAppInfo')}</p>
            {!isTauriEnv && (
              <p className="text-amber-600 dark:text-amber-400">
                {t('desktopOnly')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
