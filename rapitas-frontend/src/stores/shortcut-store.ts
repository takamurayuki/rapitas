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
  | 'toggleBrowser'
  | 'triageApprove'
  | 'triageDefer'
  | 'triageReject'
  | 'triageNext';

/** Triage-screen ids: plain single keys, handled only by the /triage page, never by the global handler. */
export const TRIAGE_SHORTCUT_IDS = [
  'triageApprove',
  'triageDefer',
  'triageReject',
  'triageNext',
] as const satisfies readonly ShortcutId[];

/** Whether the id belongs to the triage screen (and so must be skipped by global key handlers). */
export function isTriageShortcutId(id: ShortcutId): boolean {
  return (TRIAGE_SHORTCUT_IDS as readonly ShortcutId[]).includes(id);
}

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
};

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  {
    id: 'newTask',
    key: 'N',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'dashboard',
    key: 'D',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'home',
    key: 'H',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'kanban',
    key: 'K',
    meta: true,
    shift: true,
    ctrl: false,
  },
  {
    id: 'calendar',
    key: 'L',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'focusMode',
    key: 'F',
    meta: true,
    shift: true,
    ctrl: false,
  },
  {
    id: 'shortcutHelp',
    key: '/',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'toggleAI',
    key: 'E',
    meta: false,
    shift: false,
    ctrl: true,
  },
  {
    id: 'commandBar',
    key: 'K',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    // Ctrl+B is also the browser's bold in a contentEditable. The global
    // handler skips contentEditable targets (#1074), so this never fires
    // while typing in a note.
    id: 'toggleBrowser',
    key: 'B',
    meta: false,
    shift: false,
    ctrl: true,
  },
  { id: 'triageApprove', key: 'A', meta: false, shift: false, ctrl: false },
  { id: 'triageDefer', key: 'H', meta: false, shift: false, ctrl: false },
  { id: 'triageReject', key: 'R', meta: false, shift: false, ctrl: false },
  { id: 'triageNext', key: 'N', meta: false, shift: false, ctrl: false },
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
    binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>,
  ) => ShortcutBinding | undefined;
}

function formatBindingKey(b: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push('ctrl');
  if (b.meta) parts.push('meta');
  if (b.shift) parts.push('shift');
  parts.push(b.key ? b.key.toUpperCase() : '');
  return parts.join('+');
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
      // NOTE: persisted data written before a shortcut id existed lacks it; without
      // this merge the persisted array would replace the defaults and drop the new id.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<ShortcutState> | undefined)?.shortcuts;
        if (!Array.isArray(stored)) return current;
        const known = new Set(stored.map((s) => s.id));
        const missing = DEFAULT_SHORTCUTS.filter((d) => !known.has(d.id)).map((d) => ({ ...d }));
        return { ...current, shortcuts: [...stored, ...missing] };
      },
    },
  ),
);

export { DEFAULT_SHORTCUTS, formatBindingKey };
