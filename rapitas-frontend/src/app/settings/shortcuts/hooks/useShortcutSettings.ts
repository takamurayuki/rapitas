'use client';
// use-shortcut-settings

import { useEffect, useState } from 'react';
import { isTauri } from '@/utils/tauri';
import { useTranslations } from 'next-intl';
import { DEFAULT_GLOBAL_SHORTCUT, DEFAULT_CAPTURE_SHORTCUT } from './shortcut-utils';
import { useShortcutSlot } from './use-shortcut-slot';
import { useInAppShortcuts } from './use-in-app-shortcuts';

// Re-export so consumers that imported from this file keep working
export type { ModifierKey } from './shortcut-utils';
export {
  AVAILABLE_KEYS,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_CAPTURE_SHORTCUT,
  parseGlobalShortcut,
  buildGlobalShortcut,
  MODIFIER_KEYS,
  formatShortcutDisplay,
} from './shortcut-utils';

/**
 * Manages global shortcut state (main + quick-capture), in-app shortcut
 * editing, and keyboard recording. Orchestrates one `useShortcutSlot`
 * instance per global shortcut and one `useInAppShortcuts` instance.
 *
 * @returns All state and handler functions needed by the Shortcuts settings page
 */
export function useShortcutSettings() {
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const tc = useTranslations('common');

  useEffect(() => {
    setIsTauriEnv(isTauri());
  }, []);

  const global = useShortcutSlot({
    getCommand: 'get_global_shortcut',
    setCommand: 'set_global_shortcut',
    localStorageKey: 'globalShortcut',
    defaultShortcut: DEFAULT_GLOBAL_SHORTCUT,
    isTauriEnv,
  });

  const capture = useShortcutSlot({
    getCommand: 'get_capture_shortcut',
    setCommand: 'set_capture_shortcut',
    localStorageKey: 'captureShortcut',
    defaultShortcut: DEFAULT_CAPTURE_SHORTCUT,
    isTauriEnv,
  });

  const inApp = useInAppShortcuts();

  return {
    isTauriEnv,
    // Global shortcut (main)
    currentGlobalShortcut: global.currentShortcut,
    globalModifiers: global.modifiers,
    globalKey: global.key,
    setGlobalKey: global.setKey,
    isLoadingGlobal: global.isLoading,
    isSavingGlobal: global.isSaving,
    globalMessage: global.message,
    isRecordingGlobal: global.isRecording,
    setIsRecordingGlobal: global.setIsRecording,
    newGlobalShortcut: global.newShortcut,
    hasGlobalChanges: global.hasChanges,
    toggleGlobalModifier: global.toggleModifier,
    handleSaveGlobal: global.handleSave,
    handleResetGlobal: global.handleReset,
    // Quick-capture shortcut
    currentCaptureShortcut: capture.currentShortcut,
    captureModifiers: capture.modifiers,
    captureKey: capture.key,
    setCaptureKey: capture.setKey,
    isLoadingCapture: capture.isLoading,
    isSavingCapture: capture.isSaving,
    captureMessage: capture.message,
    isRecordingCapture: capture.isRecording,
    setIsRecordingCapture: capture.setIsRecording,
    newCaptureShortcut: capture.newShortcut,
    hasCaptureChanges: capture.hasChanges,
    toggleCaptureModifier: capture.toggleModifier,
    handleSaveCapture: capture.handleSave,
    handleResetCapture: capture.handleReset,
    // In-app shortcuts
    shortcuts: inApp.shortcuts,
    editingId: inApp.editingId,
    editBinding: inApp.editBinding,
    isRecordingInApp: inApp.isRecordingInApp,
    setIsRecordingInApp: inApp.setIsRecordingInApp,
    inAppMessage: inApp.inAppMessage,
    duplicateWarning: inApp.duplicateWarning,
    getDefault: inApp.getDefault,
    startEditing: inApp.startEditing,
    cancelEditing: inApp.cancelEditing,
    handleSaveInApp: inApp.handleSaveInApp,
    handleResetInApp: inApp.handleResetInApp,
    handleResetAll: inApp.handleResetAll,
    tc,
  };
}
