'use client';
// ShortcutSettingsPage

import { Keyboard, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useShortcutSettings } from './hooks/useShortcutSettings';
import { ShortcutRecorderSection } from './components/shortcut-recorder-section';
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
    // Quick-capture shortcut
    currentCaptureShortcut,
    captureModifiers,
    captureKey,
    setCaptureKey,
    isLoadingCapture,
    isSavingCapture,
    captureMessage,
    isRecordingCapture,
    setIsRecordingCapture,
    newCaptureShortcut,
    hasCaptureChanges,
    toggleCaptureModifier,
    handleSaveCapture,
    handleResetCapture,
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

  if (isLoadingGlobal || isLoadingCapture) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex items-center justify-center w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
          <Keyboard className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('description')}</p>
        </div>
      </div>

      <ShortcutRecorderSection
        title={t('globalShortcuts')}
        description={t('globalDescription')}
        currentShortcut={currentGlobalShortcut}
        modifiers={globalModifiers}
        activeKey={globalKey}
        isRecording={isRecordingGlobal}
        isSaving={isSavingGlobal}
        message={globalMessage}
        newShortcut={newGlobalShortcut}
        hasChanges={hasGlobalChanges}
        onToggleRecording={() => setIsRecordingGlobal(!isRecordingGlobal)}
        onToggleModifier={toggleGlobalModifier}
        onKeyChange={(key) => {
          setGlobalKey(key);
        }}
        onSave={handleSaveGlobal}
        onReset={handleResetGlobal}
      />

      <ShortcutRecorderSection
        title={t('captureShortcuts')}
        description={t('captureDescription')}
        currentShortcut={currentCaptureShortcut}
        modifiers={captureModifiers}
        activeKey={captureKey}
        isRecording={isRecordingCapture}
        isSaving={isSavingCapture}
        message={captureMessage}
        newShortcut={newCaptureShortcut}
        hasChanges={hasCaptureChanges}
        onToggleRecording={() => setIsRecordingCapture(!isRecordingCapture)}
        onToggleModifier={toggleCaptureModifier}
        onKeyChange={(key) => {
          setCaptureKey(key);
        }}
        onSave={handleSaveCapture}
        onReset={handleResetCapture}
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
      <div className="bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800/30 p-4">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-sm text-indigo-700 dark:text-indigo-300 space-y-1">
            <p>{t('globalInfo')}</p>
            <p>{t('duplicateGlobalCaptureNote')}</p>
            <p>{t('inAppInfo')}</p>
            {!isTauriEnv && (
              <p className="text-amber-600 dark:text-amber-400">{t('desktopOnly')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
