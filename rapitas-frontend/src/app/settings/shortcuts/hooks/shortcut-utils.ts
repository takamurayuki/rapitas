/**
 * shortcut-utils
 *
 * Pure constants and helper functions shared across the Shortcuts settings feature.
 * Not responsible for state management or React rendering.
 */

import type { ShortcutBinding } from '@/stores/shortcut-store';

/** Modifier keys supported for global shortcuts. */
export type ModifierKey = 'Ctrl' | 'Alt' | 'Shift';

/** All supported modifier keys. */
export const MODIFIER_KEYS: ModifierKey[] = ['Ctrl', 'Alt', 'Shift'];

/** All keys available for shortcut assignment. */
export const AVAILABLE_KEYS = [
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

/** Default global shortcut string used for resets. */
export const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+R';

/**
 * Parses a shortcut string like "Ctrl+Alt+R" into modifiers and key.
 *
 * @param shortcut - Shortcut string to parse / 解析するショートカット文字列
 * @returns Object with modifiers array and key string
 */
export function parseGlobalShortcut(shortcut: string): {
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

/**
 * Builds a shortcut string from modifiers and key.
 *
 * @param modifiers - Active modifier keys / アクティブな修飾キー
 * @param key - Main key / メインキー
 * @returns Formatted shortcut string e.g. "Ctrl+Alt+R"
 */
export function buildGlobalShortcut(
  modifiers: ModifierKey[],
  key: string,
): string {
  return [...modifiers, key].join('+');
}

/**
 * Formats a ShortcutBinding into a human-readable display string.
 *
 * @param binding - The binding to format / フォーマットするバインディング
 * @returns Display string e.g. "Ctrl + E" / 表示文字列
 */
export function formatShortcutDisplay(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

/**
 * Resolves a raw KeyboardEvent key to a normalized key string suitable for shortcut storage.
 * Returns null if the key is not in the allowed set.
 *
 * @param e - The keyboard event / キーボードイベント
 * @returns Normalized key string or null / 正規化されたキー文字列またはnull
 */
export function resolveKeyFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toUpperCase();
  if (key === '/') return '/';
  if (key.length === 1 && /[A-Z0-9]/.test(key)) return key;
  if (e.code.startsWith('Key')) return e.code.replace('Key', '');
  if (e.code.startsWith('Digit')) return e.code.replace('Digit', '');
  if (e.code.startsWith('F') && /^F\d+$/.test(e.code)) return e.code;
  return null;
}
