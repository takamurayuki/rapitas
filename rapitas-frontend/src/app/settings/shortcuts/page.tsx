'use client';

import { useEffect, useState, useCallback } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Keyboard,
  Save,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { isTauri } from '@/utils/tauri';
import {
  useShortcutStore,
  formatBindingKey,
  type ShortcutId,
  type ShortcutBinding,
} from '@/stores/shortcutStore';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('ShortcutsPage');

type ModifierKey = 'Ctrl' | 'Alt' | 'Shift';

const MODIFIER_KEYS: ModifierKey[] = ['Ctrl', 'Alt', 'Shift'];

const AVAILABLE_KEYS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  '/',
];

const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+R';

function parseGlobalShortcut(shortcut: string): {
  modifiers: ModifierKey[];
  key: string;
} {
  const parts = shortcut.split('+').map((s) => s.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts
    .slice(0, -1)
    .filter((m): m is ModifierKey => MODIFIER_KEYS.includes(m as ModifierKey));
  return { modifiers, key };
}

function buildGlobalShortcut(modifiers: ModifierKey[], key: string): string {
  return [...modifiers, key].join('+');
}

function formatShortcutDisplay(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

export default function ShortcutSettingsPage() {
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const t = useTranslations('shortcuts');
  const tc = useTranslations('common');

  // --- グローバルショートカット (Tauri) ---
  const [currentGlobalShortcut, setCurrentGlobalShortcut] = useState(
    DEFAULT_GLOBAL_SHORTCUT,
  );
  const [globalModifiers, setGlobalModifiers] = useState<ModifierKey[]>([
    'Ctrl',
    'Alt',
  ]);
  const [globalKey, setGlobalKey] = useState('R');
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(true);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRecordingGlobal, setIsRecordingGlobal] = useState(false);

  // --- アプリ内ショートカット ---
  const {
    shortcuts,
    updateShortcut,
    resetShortcut,
    resetAll,
    findDuplicate,
    getDefault,
  } = useShortcutStore();
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

  // --- グローバルショートカットの読み込み ---
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

  // --- グローバルショートカットのキーボード入力 ---
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

      let key = e.key.toUpperCase();
      if (key.length === 1 && /[A-Z0-9]/.test(key)) {
        // OK
      } else if (e.code.startsWith('Key')) {
        key = e.code.replace('Key', '');
      } else if (e.code.startsWith('Digit')) {
        key = e.code.replace('Digit', '');
      } else if (e.code.startsWith('F') && /^F\d+$/.test(e.code)) {
        key = e.code;
      } else {
        return;
      }

      if (AVAILABLE_KEYS.includes(key)) {
        setGlobalModifiers(modifiers);
        setGlobalKey(key);
        setGlobalMessage(null);
      }
      setIsRecordingGlobal(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecordingGlobal]);

  // --- アプリ内ショートカットのキーボード入力 ---
  useEffect(() => {
    if (!isRecordingInApp || !editingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      let key = e.key.toUpperCase();
      if (key === '/') {
        key = '/';
      } else if (key.length === 1 && /[A-Z0-9]/.test(key)) {
        // OK
      } else if (e.code.startsWith('Key')) {
        key = e.code.replace('Key', '');
      } else if (e.code.startsWith('Digit')) {
        key = e.code.replace('Digit', '');
      } else if (e.code.startsWith('F') && /^F\d+$/.test(e.code)) {
        key = e.code;
      } else {
        return;
      }

      const binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'> =
        {
          key,
          meta: e.ctrlKey || e.metaKey,
          shift: e.shiftKey,
          ctrl: false,
        };

      setEditBinding(binding);
      setIsRecordingInApp(false);

      // 重複チェック
      const dup = findDuplicate(editingId, binding);
      if (dup) {
        setDuplicateWarning(t('duplicateWith', { label: dup.label }));
      } else {
        setDuplicateWarning(null);
      }
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
      setGlobalMessage({
        type: 'error',
        text: t('selectModifiers'),
      });
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

    // 重複チェック
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
    // リセット先のデフォルト値が他のショートカットと重複しないかチェック
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
    if (editingId === id) {
      cancelEditing();
    }
    setInAppMessage({ type: 'success', text: t('resetDone') });
    setTimeout(() => setInAppMessage(null), 3000);
  };

  const handleResetAll = () => {
    resetAll();
    cancelEditing();
    setInAppMessage({
      type: 'success',
      text: t('resetAllDone'),
    });
    setTimeout(() => setInAppMessage(null), 3000);
  };

  const newGlobalShortcut = buildGlobalShortcut(globalModifiers, globalKey);
  const hasGlobalChanges = newGlobalShortcut !== currentGlobalShortcut;

  if (isLoadingGlobal) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* ヘッダー */}
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

      {/* ===== セクション1: グローバルショートカット ===== */}
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
          {t('globalShortcuts')}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          {t('globalDescription')}
        </p>

        {/* 現在の設定 */}
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

        {/* キーボード入力モード */}
        <div className="mb-4">
          <button
            onClick={() => setIsRecordingGlobal(!isRecordingGlobal)}
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

        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('orSelectManually')}
          </span>
          <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
        </div>

        {/* 修飾キー */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('modifierKeys')}
          </label>
          <div className="flex gap-3">
            {MODIFIER_KEYS.map((mod) => (
              <button
                key={mod}
                onClick={() => toggleGlobalModifier(mod)}
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

        {/* キー選択 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('key')}
          </label>
          <select
            value={globalKey}
            onChange={(e) => {
              setGlobalKey(e.target.value);
              setGlobalMessage(null);
            }}
            className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none"
          >
            {AVAILABLE_KEYS.filter((k) => k !== '/').map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>

        {/* プレビュー */}
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

        {/* メッセージ */}
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

        {/* ボタン */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveGlobal}
            disabled={
              !hasGlobalChanges ||
              isSavingGlobal ||
              globalModifiers.length === 0
            }
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
            onClick={handleResetGlobal}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            {t('resetToDefault')}
          </button>
        </div>
      </div>

      {/* ===== セクション2: アプリ内ショートカット ===== */}
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
              {t('inAppShortcuts')}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('inAppDescription')}
            </p>
          </div>
          <button
            onClick={handleResetAll}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('resetAll')}
          </button>
        </div>

        {/* メッセージ */}
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

        {/* ショートカット一覧 */}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
          {shortcuts.map((shortcut) => {
            const isEditing = editingId === shortcut.id;
            const def = getDefault(shortcut.id);
            const isModified =
              def && formatBindingKey(shortcut) !== formatBindingKey(def);

            return (
              <div key={shortcut.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {shortcut.label}
                    </span>
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
                          onClick={() => startEditing(shortcut.id)}
                          className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                        >
                          {tc('change')}
                        </button>
                        {isModified && (
                          <button
                            onClick={() => handleResetInApp(shortcut.id)}
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

                {/* 編集モード */}
                {isEditing && editBinding && (
                  <div className="mt-3 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    {/* キーボード入力 */}
                    <button
                      onClick={() => setIsRecordingInApp(!isRecordingInApp)}
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

                    {/* プレビュー */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {t('newKey')}
                      </span>
                      <kbd className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-sm font-mono font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700">
                        {formatShortcutDisplay({ ...shortcut, ...editBinding })}
                      </kbd>
                    </div>

                    {/* 重複警告 */}
                    {duplicateWarning && (
                      <div className="flex items-center gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg mb-3">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="text-sm">{duplicateWarning}</span>
                      </div>
                    )}

                    {/* ボタン */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveInApp}
                        disabled={!!duplicateWarning}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 dark:disabled:text-zinc-400 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {tc('save')}
                      </button>
                      <button
                        onClick={cancelEditing}
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

      {/* 補足情報 */}
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
