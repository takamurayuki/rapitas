'use client';
// in-app-shortcuts-section

import { Keyboard, Save, RotateCcw, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatBindingKey, type ShortcutId, type ShortcutBinding } from '@/stores/shortcut-store';
import { formatShortcutDisplay } from '../hooks/useShortcutSettings';

/** A single shortcut entry as stored in the Zustand store. */
type ShortcutEntry = ShortcutBinding & { id: ShortcutId; label: string };

/** Props for InAppShortcutsSection. */
interface InAppShortcutsSectionProps {
  /** All in-app shortcuts from the store / ストアのすべてのショートカット */
  shortcuts: ShortcutEntry[];
  /** ID of the shortcut currently being edited, or null / 編集中のショートカットID */
  editingId: ShortcutId | null;
  /** Pending binding for the shortcut being edited / 編集中のバインディング */
  editBinding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'> | null;
  /** Whether keyboard recording mode is active for in-app shortcuts / 録音モードがアクティブか */
  isRecordingInApp: boolean;
  /** Feedback message after save/reset / 保存・リセット後のフィードバックメッセージ */
  inAppMessage: { type: 'success' | 'error'; text: string } | null;
  /** Duplicate conflict warning text, or null if no conflict / 重複競合の警告テキスト */
  duplicateWarning: string | null;
  /**
   * Returns the default binding for a given shortcut ID, or undefined.
   *
   * @param id - Shortcut ID / ショートカットID
   */
  getDefault: (id: ShortcutId) => ShortcutBinding | undefined;
  /** Start editing a shortcut by ID / ショートカットの編集開始 */
  onStartEditing: (id: ShortcutId) => void;
  /** Cancel the current edit / 編集のキャンセル */
  onCancelEditing: () => void;
  /** Save the current pending binding / 現在の保留バインディングを保存 */
  onSaveInApp: () => void;
  /** Reset a single shortcut to its default / 単一ショートカットをデフォルトにリセット */
  onResetInApp: (id: ShortcutId) => void;
  /** Reset all in-app shortcuts to defaults / すべてのショートカットをデフォルトにリセット */
  onResetAll: () => void;
  /** Toggle keyboard recording mode / キーボード録音モードの切り替え */
  onToggleRecording: () => void;
}

/**
 * In-app shortcut list with per-row editing, recording, and reset controls.
 */
export function InAppShortcutsSection({
  shortcuts,
  editingId,
  editBinding,
  isRecordingInApp,
  inAppMessage,
  duplicateWarning,
  getDefault,
  onStartEditing,
  onCancelEditing,
  onSaveInApp,
  onResetInApp,
  onResetAll,
  onToggleRecording,
}: InAppShortcutsSectionProps) {
  const t = useTranslations('shortcuts');
  const tc = useTranslations('common');

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
            {t('inAppShortcuts')}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('inAppDescription')}</p>
        </div>
        <button
          onClick={onResetAll}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('resetAll')}
        </button>
      </div>

      {/* Feedback message */}
      {inAppMessage && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
            inAppMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}
        >
          {inAppMessage.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="text-sm">{inAppMessage.text}</span>
        </div>
      )}

      {/* Shortcut rows */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
        {shortcuts.map((shortcut) => {
          const isEditing = editingId === shortcut.id;
          const def = getDefault(shortcut.id);
          const isModified = def && formatBindingKey(shortcut) !== formatBindingKey(def);

          return (
            <div key={shortcut.id} className="py-3">
              {/* Row header: label + current binding + edit button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{shortcut.label}</span>
                  {isModified && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                      {t('modified')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <>
                      <kbd className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-sm font-mono font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600">
                        {formatShortcutDisplay(shortcut)}
                      </kbd>
                      <button
                        onClick={() => onStartEditing(shortcut.id)}
                        className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                      >
                        {tc('change')}
                      </button>
                      {isModified && (
                        <button
                          onClick={() => onResetInApp(shortcut.id)}
                          className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg transition-colors"
                          title={t('resetToDefault')}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Inline editor */}
              {isEditing && editBinding && (
                <div className="mt-3 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  {/* Keyboard recording button */}
                  <button
                    onClick={onToggleRecording}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed transition-all mb-3 ${
                      isRecordingInApp
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                        : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:border-indigo-400'
                    }`}
                  >
                    <Keyboard className="w-4 h-4" />
                    <span className="text-sm">
                      {isRecordingInApp ? t('pressKey') : t('clickToEnter')}
                    </span>
                  </button>

                  {/* New binding preview */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('newKey')}</span>
                    <kbd className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-sm font-mono font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700">
                      {formatShortcutDisplay({ ...shortcut, ...editBinding })}
                    </kbd>
                  </div>

                  {/* Duplicate warning */}
                  {duplicateWarning && (
                    <div className="flex items-center gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg mb-3">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{duplicateWarning}</span>
                    </div>
                  )}

                  {/* Save / cancel */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onSaveInApp}
                      disabled={!!duplicateWarning}
                      className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 dark:disabled:text-zinc-400 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {tc('save')}
                    </button>
                    <button
                      onClick={onCancelEditing}
                      className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                    >
                      {tc('cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
