'use client';
// use-in-app-shortcuts

import { useState, useCallback } from 'react';
import { useShortcutStore, type ShortcutId, type ShortcutBinding } from '@/stores/shortcut-store';
import { useTranslations } from 'next-intl';
import { useInAppShortcutRecording } from './shortcut-recording';

/**
 * Manages in-app shortcut editing state: which shortcut is being edited,
 * its pending binding, duplicate-conflict detection, and keyboard recording.
 *
 * @returns In-app shortcut state and handler functions
 */
export function useInAppShortcuts() {
  const t = useTranslations('shortcuts');
  const tLabels = useTranslations('shortcuts.labels');

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

  const handleInAppRecord = useCallback(
    (binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>) => {
      setEditBinding(binding);
      if (editingId) {
        const dup = findDuplicate(editingId, binding);
        setDuplicateWarning(dup ? t('duplicateWith', { label: tLabels(dup.id) }) : null);
      }
    },
    [editingId, findDuplicate, t, tLabels],
  );

  useInAppShortcutRecording(
    isRecordingInApp,
    editingId,
    handleInAppRecord,
    useCallback(() => setIsRecordingInApp(false), []),
  );

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
        text: t('cannotSaveDuplicate', { label: tLabels(dup.id) }),
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
          text: t('defaultConflictsWith', { label: tLabels(dup.id) }),
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

  return {
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
  };
}
