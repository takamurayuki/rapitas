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
  | 'focusSearch'
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
    // NOTE: Was ⌘K until ⌘K became the header search's focus key (focusSearch,
    // below) — ⌘K for search is the convention users expect. ⌘⇧P keeps the
    // "command palette" association; see LEGACY_COMMAND_BAR for the migration.
    id: 'commandBar',
    key: 'P',
    meta: true,
    shift: true,
    ctrl: false,
  },
  {
    id: 'focusSearch',
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

/** The command bar's default before ⌘K moved to focusSearch; migrated once on load. */
const LEGACY_COMMAND_BAR = { key: 'K', meta: true, shift: false, ctrl: false } as const;

function formatBindingKey(b: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push('ctrl');
  if (b.meta) parts.push('meta');
  if (b.shift) parts.push('shift');
  parts.push(b.key ? b.key.toUpperCase() : '');
  return parts.join('+');
}

/**
 * One-time migration for data saved before focusSearch existed. Such data
 * still holds the command bar on its old default ⌘K, which focusSearch now
 * takes. Each step only happens when it collides with nothing the user
 * already saved, so a custom binding elsewhere is never shadowed:
 * - the command bar moves to its new default (⌘⇧P) only if no other id holds ⌘⇧P;
 * - focusSearch gets ⌘K only if nothing holds ⌘K after that, otherwise it is
 *   added unassigned (empty key — the search field just shows no badge) and
 *   the user can pick a key in settings.
 * A ⌘K the user picks later is theirs (findDuplicate warns).
 *
 * @param stored - Bindings as persisted, without focusSearch / 保存済みの割り当て
 * @returns Bindings with focusSearch appended / focusSearch を加えた割り当て
 */
function migrateToFocusSearch(stored: ShortcutBinding[]): ShortcutBinding[] {
  let list = stored;
  const isTaken = (b: ShortcutBinding) =>
    list.some((s) => s.id !== b.id && s.key && formatBindingKey(s) === formatBindingKey(b));

  const commandBarDefault = DEFAULT_SHORTCUTS.find((d) => d.id === 'commandBar');
  const commandBar = list.find((s) => s.id === 'commandBar');
  if (
    commandBarDefault &&
    commandBar &&
    formatBindingKey(commandBar) === formatBindingKey(LEGACY_COMMAND_BAR) &&
    !isTaken(commandBarDefault)
  ) {
    list = list.map((s) => (s.id === 'commandBar' ? { ...commandBarDefault } : s));
  }

  const focusDefault = DEFAULT_SHORTCUTS.find((d) => d.id === 'focusSearch');
  if (!focusDefault) return list;
  return [...list, isTaken(focusDefault) ? { ...focusDefault, key: '' } : { ...focusDefault }];
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
        const migrated = stored.some((s) => s.id === 'focusSearch')
          ? stored
          : migrateToFocusSearch(stored);
        const known = new Set(migrated.map((s) => s.id));
        const missing = DEFAULT_SHORTCUTS.filter((d) => !known.has(d.id)).map((d) => ({ ...d }));
        return { ...current, shortcuts: [...migrated, ...missing] };
      },
    },
  ),
);

export { DEFAULT_SHORTCUTS, formatBindingKey };
