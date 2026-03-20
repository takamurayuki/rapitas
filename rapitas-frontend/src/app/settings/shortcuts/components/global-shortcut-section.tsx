/**
 * global-shortcut-section
 *
 * UI section for configuring the global (OS-level) keyboard shortcut that activates the app.
 * Supports keyboard recording, manual modifier + key selection, and Tauri/localStorage persistence.
 * Not responsible for in-app shortcut management; see in-app-shortcuts-section.tsx.
 */

'use client';

import {
  Keyboard,
  Save,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MODIFIER_KEYS, AVAILABLE_KEYS, type ModifierKey } from '../hooks/use-shortcut-settings';

/** Props for GlobalShortcutSection. */
interface GlobalShortcutSectionProps {
  /** The currently persisted shortcut string / 現在保存されているショートカット */
  currentGlobalShortcut: string;
  /** Active modifier keys in the editor / エディタでアクティブな修飾キー */
  globalModifiers: ModifierKey[];
  /** Active main key in the editor / エディタでアクティブなメインキー */
  globalKey: string;
  /** Whether keyboard recording mode is active / キーボード録音モードがアクティブか */
  isRecordingGlobal: boolean;
  /** Whether a save operation is in progress / 保存処理中かどうか */
  isSavingGlobal: boolean;
  /** Feedback message after save or error / 保存後のフィードバックメッセージ */
  globalMessage: { type: 'success' | 'error'; text: string } | null;
  /** The shortcut that would be saved with current selections / 現在の選択で保存されるショートカット */
  newGlobalShortcut: string;
  /** Whether the editor differs from the persisted value / エディタが保存値と異なるか */
  hasGlobalChanges: boolean;
  /** Toggle recording mode on/off / 録音モードの切り替え */
  onToggleRecording: () => void;
  /** Toggle a modifier key on/off / 修飾キーの切り替え */
  onToggleModifier: (mod: ModifierKey) => void;
  /** Update the main key / メインキーの更新 */
  onKeyChange: (key: string) => void;
  /** Persist the current selection / 現在の選択を保存 */
  onSave: () => void;
  /** Reset to the default shortcut / デフォルトショートカットにリセット */
  onReset: () => void;
}

/**
 * Global shortcut configuration card.
 * Renders current value, record button, modifier toggles, key selector, and save/reset actions.
 */
export function GlobalShortcutSection({
  currentGlobalShortcut,
  globalModifiers,
  globalKey,
  isRecordingGlobal,
  isSavingGlobal,
  globalMessage,
  newGlobalShortcut,
  hasGlobalChanges,
  onToggleRecording,
  onToggleModifier,
  onKeyChange,
  onSave,
  onReset,
}: GlobalShortcutSectionProps) {
  const t = useTranslations('shortcuts');
  const tc = useTranslations('common');

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
        {t('globalShortcuts')}
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        {t('globalDescription')}
      </p>

      {/* Current value display */}
      <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('currentSetting')}
          </span>
          <kbd className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 rounded-lg text-lg font-mono font-semibold text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600 shadow-sm">
            {currentGlobalShortcut}
          </kbd>
        </div>
      </div>

      {/* Keyboard recording button */}
      <div className="mb-4">
        <button
          onClick={onToggleRecording}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed transition-all ${
            isRecordingGlobal
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
              : 'border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400'
          }`}
        >
          <Keyboard className="w-5 h-5" />
          <span className="text-sm font-medium">
            {isRecordingGlobal ? t('pressKey') : t('clickToEnter')}
          </span>
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {t('orSelectManually')}
        </span>
        <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
      </div>

      {/* Modifier key toggles */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('modifierKeys')}
        </label>
        <div className="flex gap-3">
          {MODIFIER_KEYS.map((mod) => (
            <button
              key={mod}
              onClick={() => onToggleModifier(mod)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                globalModifiers.includes(mod)
                  ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {mod}
            </button>
          ))}
        </div>
      </div>

      {/* Key selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('key')}
        </label>
        <select
          value={globalKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none"
        >
          {AVAILABLE_KEYS.filter((k) => k !== '/').map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>

      {/* New shortcut preview */}
      {hasGlobalChanges && (
        <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('newShortcut')}
            </span>
            <kbd className="px-4 py-2 rounded-lg text-lg font-mono font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700">
              {newGlobalShortcut}
            </kbd>
          </div>
        </div>
      )}

      {/* Feedback message */}
      {globalMessage && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
            globalMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}
        >
          {globalMessage.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="text-sm">{globalMessage.text}</span>
        </div>
      )}

      {/* Save / reset actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={!hasGlobalChanges || isSavingGlobal || globalModifiers.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 dark:disabled:text-zinc-400 rounded-lg text-sm font-medium transition-colors"
        >
          {isSavingGlobal ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {tc('save')}
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          {t('resetToDefault')}
        </button>
      </div>
    </div>
  );
}
