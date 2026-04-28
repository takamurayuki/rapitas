'use client';
// use-shortcut-settings

import { useEffect, useState, useCallback } from 'react';
import { isTauri } from '@/utils/tauri';
import { useShortcutStore, type ShortcutId, type ShortcutBinding } from '@/stores/shortcut-store';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import {
  type ModifierKey,
  AVAILABLE_KEYS,
  DEFAULT_GLOBAL_SHORTCUT,
  parseGlobalShortcut,
  buildGlobalShortcut,
  resolveKeyFromEvent,
} from './shortcut-utils';

// Re-export so consumers that imported from this file keep working
export type { ModifierKey };
export {
  AVAILABLE_KEYS,
  DEFAULT_GLOBAL_SHORTCUT,
  parseGlobalShortcut,
  buildGlobalShortcut,
  MODIFIER_KEYS,
  formatShortcutDisplay,
} from './shortcut-utils';

const logger = createLogger('useShortcutSettings');

/**
 * Manages global shortcut state, in-app shortcut editing, and keyboard recording.
 *
 * @returns All state and handler functions needed by the Shortcuts settings page
 */
export function useShortcutSettings() {
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const t = useTranslations('shortcuts');
  const tc = useTranslations('common');

  const [currentGlobalShortcut, setCurrentGlobalShortcut] = useState(DEFAULT_GLOBAL_SHORTCUT);
  const [globalModifiers, setGlobalModifiers] = useState<ModifierKey[]>(['Ctrl', 'Alt']);
  const [globalKey, setGlobalKey] = useState('R');
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(true);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRecordingGlobal, setIsRecordingGlobal] = useState(false);

  const { shortcuts, updateShortcut, resetShortcut, resetAll, findDuplicate, getDefault } =
    useShortcutStore();
  const [editingId, setEditingId] = useState<ShortcutId | null>(null);
  const [editBinding, setEditBinding] = useState<Pick<
    ShortcutBinding,
    'key' | 'meta' | 'shift' | 'ctrl'
  > | null>(null);
  const [isRecordingInApp, setIsRecordingInApp] = useState(false);
  const [inAppMessage, setInAppMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    setIsTauriEnv(isTauri());
  }, []);

  const loadGlobalShortcut = useCallback(async () => {
    if (!isTauriEnv) {
      const saved = localStorage.getItem('globalShortcut');
      if (saved) {
        setCurrentGlobalShortcut(saved);
        const { modifiers, key } = parseGlobalShortcut(saved);
        setGlobalModifiers(modifiers);
        setGlobalKey(key);
      }
      setIsLoadingGlobal(false);
      return;
    }

    try {
      const tauri = window.__TAURI__;
      if (tauri?.core?.invoke) {
        const result = await tauri.core.invoke('get_global_shortcut');
        const shortcut = String(result);
        setCurrentGlobalShortcut(shortcut);
        const { modifiers, key } = parseGlobalShortcut(shortcut);
        setGlobalModifiers(modifiers);
        setGlobalKey(key);
      }
    } catch (e) {
      logger.error('Failed to load shortcut:', e);
    } finally {
      setIsLoadingGlobal(false);
    }
  }, [isTauriEnv]);

  useEffect(() => {
    loadGlobalShortcut();
  }, [loadGlobalShortcut]);

  // Global shortcut keyboard recording
  useEffect(() => {
    if (!isRecordingGlobal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const modifiers: ModifierKey[] = [];
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');

      const key = resolveKeyFromEvent(e);
      if (key && AVAILABLE_KEYS.includes(key)) {
        setGlobalModifiers(modifiers);
        setGlobalKey(key);
        setGlobalMessage(null);
      }
      setIsRecordingGlobal(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecordingGlobal]);

  // In-app shortcut keyboard recording
  useEffect(() => {
    if (!isRecordingInApp || !editingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const key = resolveKeyFromEvent(e);
      if (!key) return;

      const binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'> = {
        key,
        meta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        ctrl: false,
      };

      setEditBinding(binding);
      setIsRecordingInApp(false);

      const dup = findDuplicate(editingId, binding);
      setDuplicateWarning(dup ? t('duplicateWith', { label: dup.label }) : null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecordingInApp, editingId, findDuplicate]);

  const toggleGlobalModifier = (mod: ModifierKey) => {
    setGlobalModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
    );
    setGlobalMessage(null);
  };

  const handleSaveGlobal = async () => {
    if (globalModifiers.length === 0) {
      setGlobalMessage({ type: 'error', text: t('selectModifiers') });
      return;
    }

    const newShortcut = buildGlobalShortcut(globalModifiers, globalKey);
    setIsSavingGlobal(true);
    setGlobalMessage(null);

    if (!isTauriEnv) {
      localStorage.setItem('globalShortcut', newShortcut);
      setCurrentGlobalShortcut(newShortcut);
      setGlobalMessage({
        type: 'success',
        text: t('changedToShortcut', { shortcut: newShortcut }),
      });
      setIsSavingGlobal(false);
      return;
    }

    try {
      const tauri = window.__TAURI__;
      if (tauri?.core?.invoke) {
        await tauri.core.invoke('set_global_shortcut', {
          shortcut: newShortcut,
        });
        setCurrentGlobalShortcut(newShortcut);
        setGlobalMessage({
          type: 'success',
          text: t('changedToShortcut', { shortcut: newShortcut }),
        });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setGlobalMessage({
        type: 'error',
        text: `${t('changeFailed')} ${errorMsg}`,
      });
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleResetGlobal = () => {
    const { modifiers, key } = parseGlobalShortcut(DEFAULT_GLOBAL_SHORTCUT);
    setGlobalModifiers(modifiers);
    setGlobalKey(key);
    setGlobalMessage(null);
  };

  const startEditing = (id: ShortcutId) => {
    const current = shortcuts.find((s) => s.id === id);
    if (!current) return;
    setEditingId(id);
    setEditBinding({
      key: current.key,
      meta: current.meta,
      shift: current.shift,
      ctrl: current.ctrl,
    });
    setDuplicateWarning(null);
    setInAppMessage(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditBinding(null);
    setDuplicateWarning(null);
    setIsRecordingInApp(false);
  };

  const handleSaveInApp = () => {
    if (!editingId || !editBinding) return;

    const dup = findDuplicate(editingId, editBinding);
    if (dup) {
      setInAppMessage({
        type: 'error',
        text: t('cannotSaveDuplicate', { label: dup.label }),
      });
      return;
    }

    updateShortcut(editingId, editBinding);
    setInAppMessage({ type: 'success', text: t('shortcutChanged') });
    setTimeout(() => setInAppMessage(null), 3000);
    setEditingId(null);
    setEditBinding(null);
    setDuplicateWarning(null);
  };

  const handleResetInApp = (id: ShortcutId) => {
    const def = getDefault(id);
    if (def) {
      const dup = findDuplicate(id, def);
      if (dup) {
        setInAppMessage({
          type: 'error',
          text: t('defaultConflictsWith', { label: dup.label }),
        });
        return;
      }
    }
    resetShortcut(id);
    if (editingId === id) cancelEditing();
    setInAppMessage({ type: 'success', text: t('resetDone') });
    setTimeout(() => setInAppMessage(null), 3000);
  };

  const handleResetAll = () => {
    resetAll();
    cancelEditing();
    setInAppMessage({ type: 'success', text: t('resetAllDone') });
    setTimeout(() => setInAppMessage(null), 3000);
  };

  const newGlobalShortcut = buildGlobalShortcut(globalModifiers, globalKey);
  const hasGlobalChanges = newGlobalShortcut !== currentGlobalShortcut;

  return {
    isTauriEnv,
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
    tc,
  };
}
