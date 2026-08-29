'use client';
// use-shortcut-slot

import { useEffect, useState, useCallback } from 'react';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import { type ModifierKey, parseGlobalShortcut, buildGlobalShortcut } from './shortcut-utils';
import { useKeyComboRecording } from './shortcut-recording';

const logger = createLogger('useShortcutSlot');

/** Tauri command names available for a global-shortcut-style slot. */
export type ShortcutGetCommand = 'get_global_shortcut' | 'get_capture_shortcut';
export type ShortcutSetCommand = 'set_global_shortcut' | 'set_capture_shortcut';

/** Configuration for one shortcut slot (main or quick-capture). */
export interface ShortcutSlotConfig {
  /** Tauri command used to read the persisted shortcut / 読み込み用Tauriコマンド */
  getCommand: ShortcutGetCommand;
  /** Tauri command used to persist the shortcut / 保存用Tauriコマンド */
  setCommand: ShortcutSetCommand;
  /** localStorage key used in non-Tauri (web) environments / Web環境用のlocalStorageキー */
  localStorageKey: string;
  /** Default shortcut string used before load completes and on reset / デフォルトショートカット */
  defaultShortcut: string;
  /** Whether the app is currently running inside Tauri / Tauri環境かどうか */
  isTauriEnv: boolean;
}

/** State and handlers returned by useShortcutSlot for a single shortcut slot. */
export interface ShortcutSlotState {
  currentShortcut: string;
  modifiers: ModifierKey[];
  key: string;
  setKey: (key: string) => void;
  isLoading: boolean;
  isSaving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  isRecording: boolean;
  setIsRecording: (value: boolean) => void;
  newShortcut: string;
  hasChanges: boolean;
  toggleModifier: (mod: ModifierKey) => void;
  handleSave: () => Promise<void>;
  handleReset: () => void;
}

/**
 * Manages load/save/reset/recording state for one global shortcut slot
 * (e.g. the main shortcut or the quick-capture shortcut). Multiple
 * independent instances can be used side by side without interfering
 * with each other's state.
 *
 * @param config - Slot configuration (commands, storage key, default) / スロット設定
 * @returns Slot state and handlers
 */
export function useShortcutSlot(config: ShortcutSlotConfig): ShortcutSlotState {
  const { getCommand, setCommand, localStorageKey, defaultShortcut, isTauriEnv } = config;
  const t = useTranslations('shortcuts');

  const [currentShortcut, setCurrentShortcut] = useState(defaultShortcut);
  const [modifiers, setModifiers] = useState<ModifierKey[]>(
    () => parseGlobalShortcut(defaultShortcut).modifiers,
  );
  const [key, setKey] = useState(() => parseGlobalShortcut(defaultShortcut).key);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const loadShortcut = useCallback(async () => {
    if (!isTauriEnv) {
      const saved = localStorage.getItem(localStorageKey);
      if (saved) {
        setCurrentShortcut(saved);
        const { modifiers: parsedModifiers, key: parsedKey } = parseGlobalShortcut(saved);
        setModifiers(parsedModifiers);
        setKey(parsedKey);
      }
      setIsLoading(false);
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke(getCommand);
      const shortcut = String(result);
      setCurrentShortcut(shortcut);
      const { modifiers: parsedModifiers, key: parsedKey } = parseGlobalShortcut(shortcut);
      setModifiers(parsedModifiers);
      setKey(parsedKey);
    } catch (e) {
      logger.error('Failed to load shortcut:', e);
    } finally {
      setIsLoading(false);
    }
  }, [isTauriEnv, getCommand, localStorageKey]);

  useEffect(() => {
    loadShortcut();
  }, [loadShortcut]);

  const handleRecord = useCallback((recordedModifiers: ModifierKey[], recordedKey: string) => {
    setModifiers(recordedModifiers);
    setKey(recordedKey);
    setMessage(null);
  }, []);

  useKeyComboRecording(
    isRecording,
    handleRecord,
    useCallback(() => setIsRecording(false), []),
  );

  const toggleModifier = (mod: ModifierKey) => {
    setModifiers((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]));
    setMessage(null);
  };

  const handleSave = async () => {
    if (modifiers.length === 0) {
      setMessage({ type: 'error', text: t('selectModifiers') });
      return;
    }

    const newShortcut = buildGlobalShortcut(modifiers, key);
    setIsSaving(true);
    setMessage(null);

    if (!isTauriEnv) {
      localStorage.setItem(localStorageKey, newShortcut);
      setCurrentShortcut(newShortcut);
      setMessage({ type: 'success', text: t('changedToShortcut', { shortcut: newShortcut }) });
      setIsSaving(false);
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke(setCommand, { shortcut: newShortcut });
      setCurrentShortcut(newShortcut);
      setMessage({ type: 'success', text: t('changedToShortcut', { shortcut: newShortcut }) });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setMessage({ type: 'error', text: `${t('changeFailed')} ${errorMsg}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const { modifiers: parsedModifiers, key: parsedKey } = parseGlobalShortcut(defaultShortcut);
    setModifiers(parsedModifiers);
    setKey(parsedKey);
    setMessage(null);
  };

  const newShortcut = buildGlobalShortcut(modifiers, key);
  const hasChanges = newShortcut !== currentShortcut;

  return {
    currentShortcut,
    modifiers,
    key,
    setKey,
    isLoading,
    isSaving,
    message,
    isRecording,
    setIsRecording,
    newShortcut,
    hasChanges,
    toggleModifier,
    handleSave,
    handleReset,
  };
}
