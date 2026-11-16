import { describe, it, expect } from 'vitest';
import type { ShortcutBinding } from '@/stores/shortcut-store';
import {
  MODIFIER_KEYS,
  AVAILABLE_KEYS,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_CAPTURE_SHORTCUT,
  parseGlobalShortcut,
  buildGlobalShortcut,
  formatShortcutDisplay,
  resolveKeyFromEvent,
} from '../shortcut-utils';

describe('constants', () => {
  it('MODIFIER_KEYS lists the three supported modifiers', () => {
    expect(MODIFIER_KEYS).toEqual(['Ctrl', 'Alt', 'Shift']);
  });

  it('AVAILABLE_KEYS includes letters, digits, function keys, and slash', () => {
    expect(AVAILABLE_KEYS).toContain('A');
    expect(AVAILABLE_KEYS).toContain('Z');
    expect(AVAILABLE_KEYS).toContain('0');
    expect(AVAILABLE_KEYS).toContain('9');
    expect(AVAILABLE_KEYS).toContain('F1');
    expect(AVAILABLE_KEYS).toContain('F12');
    expect(AVAILABLE_KEYS).toContain('/');
  });

  it('DEFAULT_GLOBAL_SHORTCUT is Ctrl+Alt+R', () => {
    expect(DEFAULT_GLOBAL_SHORTCUT).toBe('Ctrl+Alt+R');
  });

  it('DEFAULT_CAPTURE_SHORTCUT is Ctrl+Alt+I (must match shortcut_config.rs)', () => {
    expect(DEFAULT_CAPTURE_SHORTCUT).toBe('Ctrl+Alt+I');
  });
});

describe('parseGlobalShortcut', () => {
  it('parses a shortcut with multiple modifiers', () => {
    expect(parseGlobalShortcut('Ctrl+Alt+R')).toEqual({
      modifiers: ['Ctrl', 'Alt'],
      key: 'R',
    });
  });

  it('parses a shortcut with a single modifier', () => {
    expect(parseGlobalShortcut('Shift+F1')).toEqual({
      modifiers: ['Shift'],
      key: 'F1',
    });
  });

  it('parses a shortcut with no modifiers', () => {
    expect(parseGlobalShortcut('R')).toEqual({
      modifiers: [],
      key: 'R',
    });
  });

  it('drops tokens that are not valid modifier keys', () => {
    expect(parseGlobalShortcut('Meta+Ctrl+R')).toEqual({
      modifiers: ['Ctrl'],
      key: 'R',
    });
  });

  it('trims whitespace around tokens', () => {
    expect(parseGlobalShortcut(' Ctrl + Alt + R ')).toEqual({
      modifiers: ['Ctrl', 'Alt'],
      key: 'R',
    });
  });
});

describe('buildGlobalShortcut', () => {
  it('joins modifiers and key with +', () => {
    expect(buildGlobalShortcut(['Ctrl', 'Alt'], 'R')).toBe('Ctrl+Alt+R');
  });

  it('handles an empty modifiers array', () => {
    expect(buildGlobalShortcut([], 'R')).toBe('R');
  });

  it('round-trips with parseGlobalShortcut', () => {
    const shortcut = 'Ctrl+Shift+F5';
    const { modifiers, key } = parseGlobalShortcut(shortcut);
    expect(buildGlobalShortcut(modifiers, key)).toBe(shortcut);
  });
});

describe('formatShortcutDisplay', () => {
  const base: ShortcutBinding = {
    id: 'newTask',
    key: 'n',
    meta: false,
    shift: false,
    ctrl: false,
  };

  it('formats a plain key with no modifiers', () => {
    expect(formatShortcutDisplay(base)).toBe('N');
  });

  it('formats ctrl + key', () => {
    expect(formatShortcutDisplay({ ...base, ctrl: true })).toBe('Ctrl + N');
  });

  it('formats meta as Ctrl label too', () => {
    expect(formatShortcutDisplay({ ...base, meta: true })).toBe('Ctrl + N');
  });

  it('formats shift + key', () => {
    expect(formatShortcutDisplay({ ...base, shift: true })).toBe('Shift + N');
  });

  it('does not duplicate Ctrl when both ctrl and meta are true', () => {
    expect(formatShortcutDisplay({ ...base, ctrl: true, meta: true })).toBe('Ctrl + Ctrl + N');
  });

  it('formats all modifiers combined and uppercases the key', () => {
    expect(formatShortcutDisplay({ ...base, key: 'd', ctrl: true, shift: true })).toBe(
      'Ctrl + Shift + D',
    );
  });
});

describe('resolveKeyFromEvent', () => {
  it('resolves the "/" key directly', () => {
    const event = new KeyboardEvent('keydown', { key: '/', code: 'Slash' });
    expect(resolveKeyFromEvent(event)).toBe('/');
  });

  it('resolves a single alphanumeric key from event.key', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' });
    expect(resolveKeyFromEvent(event)).toBe('A');
  });

  it('resolves a digit key from event.key', () => {
    const event = new KeyboardEvent('keydown', { key: '5', code: 'Digit5' });
    expect(resolveKeyFromEvent(event)).toBe('5');
  });

  it('falls back to event.code for KeyX-style codes when key is not a single char', () => {
    const event = new KeyboardEvent('keydown', { key: 'Unidentified', code: 'KeyB' });
    expect(resolveKeyFromEvent(event)).toBe('B');
  });

  it('falls back to event.code for DigitX-style codes', () => {
    const event = new KeyboardEvent('keydown', { key: 'Unidentified', code: 'Digit3' });
    expect(resolveKeyFromEvent(event)).toBe('3');
  });

  it('resolves function keys from event.code', () => {
    const event = new KeyboardEvent('keydown', { key: 'F5', code: 'F5' });
    expect(resolveKeyFromEvent(event)).toBe('F5');
  });

  it('returns null for unsupported keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
    expect(resolveKeyFromEvent(event)).toBeNull();
  });
});
