import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ShortcutId =
  | 'newTask'
  | 'dashboard'
  | 'home'
  | 'kanban'
  | 'calendar'
  | 'focusMode'
  | 'shortcutHelp'
  | 'toggleAI'
  | 'commandBar'
  | 'stallRecovery';

// NOTE: no static `label` field — `id` doubles as the message key under
// `shortcuts.labels` (see KeyboardShortcuts.tsx / in-app-shortcuts-section.tsx),
// so the display label stays localized instead of being frozen in this store.
export type ShortcutBinding = {
  id: ShortcutId;
  /** Key (e.g. 'N', 'D', '/') */
  key: string;
  /** Whether to use Ctrl/Cmd */
  meta: boolean;
  /** Whether to use Shift */
  shift: boolean;
  /** Ctrl only (when meta=false) */
  ctrl: boolean;
  /** Whether to use Alt (added for Ctrl+Alt+S — existing bindings stay false) */
  alt: boolean;
};

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  {
    id: 'newTask',
    key: 'N',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'dashboard',
    key: 'D',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'home',
    key: 'H',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'kanban',
    key: 'K',
    meta: true,
    shift: true,
    ctrl: false,
    alt: false,
  },
  {
    id: 'calendar',
    key: 'L',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'focusMode',
    key: 'F',
    meta: true,
    shift: true,
    ctrl: false,
    alt: false,
  },
  {
    id: 'shortcutHelp',
    key: '/',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'toggleAI',
    key: 'E',
    meta: false,
    shift: false,
    ctrl: true,
    alt: false,
  },
  {
    id: 'commandBar',
    key: 'K',
    meta: true,
    shift: false,
    ctrl: false,
    alt: false,
  },
  {
    id: 'stallRecovery',
    key: 'S',
    meta: false,
    shift: false,
    ctrl: true,
    alt: true,
  },
];

interface ShortcutState {
  shortcuts: ShortcutBinding[];
  updateShortcut: (id: ShortcutId, binding: Partial<ShortcutBinding>) => void;
  resetShortcut: (id: ShortcutId) => void;
  resetAll: () => void;
  getDefault: (id: ShortcutId) => ShortcutBinding | undefined;
  /** Duplicate check: check if same key binding exists for other ids */
  findDuplicate: (
    id: ShortcutId,
    // alt stays optional (missing = false) so pre-alt callers keep compiling.
    binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'> & { alt?: boolean },
  ) => ShortcutBinding | undefined;
}

function formatBindingKey(
  b: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'> & { alt?: boolean },
): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push('ctrl');
  if (b.meta) parts.push('meta');
  if (b.shift) parts.push('shift');
  if (b.alt) parts.push('alt');
  parts.push(b.key ? b.key.toUpperCase() : '');
  return parts.join('+');
}

/**
 * Backfills bindings persisted before the `alt` field existed (and appends
 * newly introduced default shortcuts missing from the stored array) so a
 * stale localStorage snapshot can never strip Alt matching or hide
 * `stallRecovery` from the settings UI.
 *
 * @param stored - Bindings restored from localStorage. / 復元されたバインディング
 * @returns Normalized bindings covering every ShortcutId. / 正規化済み配列
 */
function normalizeStoredShortcuts(stored: ShortcutBinding[]): ShortcutBinding[] {
  const withAlt = stored.map((s) => ({ ...s, alt: s.alt ?? false }));
  const knownIds = new Set(withAlt.map((s) => s.id));
  const missing = DEFAULT_SHORTCUTS.filter((d) => !knownIds.has(d.id)).map((d) => ({ ...d }));
  return [...withAlt, ...missing];
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      updateShortcut: (id, binding) =>
        set((state) => ({
          shortcuts: state.shortcuts.map((s) => (s.id === id ? { ...s, ...binding } : s)),
        })),
      resetShortcut: (id) =>
        set((state) => {
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === id);
          if (!def) return state;
          return {
            shortcuts: state.shortcuts.map((s) => (s.id === id ? { ...def } : s)),
          };
        }),
      resetAll: () => set({ shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })) }),
      getDefault: (id) => DEFAULT_SHORTCUTS.find((s) => s.id === id),
      findDuplicate: (id, binding) => {
        const key = formatBindingKey(binding);
        return get().shortcuts.find((s) => s.id !== id && formatBindingKey(s) === key);
      },
    }),
    {
      name: 'shortcut-bindings-storage',
      // Runs at rehydration time, BEFORE any subscriber sees the state — the
      // only hook where a stale snapshot can be fixed without a flash of
      // alt-less bindings.
      merge: (persisted, current) => {
        const stored = persisted as Partial<ShortcutState> | undefined;
        return {
          ...current,
          ...stored,
          shortcuts: normalizeStoredShortcuts(stored?.shortcuts ?? current.shortcuts),
        };
      },
    },
  ),
);

export { DEFAULT_SHORTCUTS, formatBindingKey, normalizeStoredShortcuts };
