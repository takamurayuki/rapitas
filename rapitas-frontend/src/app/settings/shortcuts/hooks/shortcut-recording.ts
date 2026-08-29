'use client';
// shortcut-recording

import { useEffect } from 'react';
import { type ShortcutId, type ShortcutBinding } from '@/stores/shortcut-store';
import { type ModifierKey, AVAILABLE_KEYS, resolveKeyFromEvent } from './shortcut-utils';

/**
 * Hook for recording a global/slot-based keyboard shortcut (modifiers + main key).
 *
 * @param isRecording - Whether recording mode is active / 録音モードがアクティブか
 * @param onRecord - Called with the recorded modifiers and key / 録音結果を受け取るコールバック
 * @param onStop - Called after a key is captured to exit recording mode / 録音終了時のコールバック
 */
export function useKeyComboRecording(
  isRecording: boolean,
  onRecord: (modifiers: ModifierKey[], key: string) => void,
  onStop: () => void,
) {
  useEffect(() => {
    if (!isRecording) return;

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
        onRecord(modifiers, key);
      }
      onStop();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onRecord, onStop]);
}

/**
 * Hook for recording an in-app keyboard shortcut binding.
 *
 * @param isRecording - Whether recording mode is active / 録音モードがアクティブか
 * @param editingId - ID of the shortcut currently being edited / 編集中のショートカットID
 * @param onRecord - Called with the recorded binding / 録音結果を受け取るコールバック
 * @param onStop - Called after a key is captured to exit recording mode / 録音終了時のコールバック
 */
export function useInAppShortcutRecording(
  isRecording: boolean,
  editingId: ShortcutId | null,
  onRecord: (binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>) => void,
  onStop: () => void,
) {
  useEffect(() => {
    if (!isRecording || !editingId) return;

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

      onRecord(binding);
      onStop();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, editingId, onRecord, onStop]);
}
