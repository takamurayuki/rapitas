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
  | 'toggleAI';

export type ShortcutBinding = {
  id: ShortcutId;
  label: string;
  /** キー（例: "N", "D", "/"） */
  key: string;
  /** Ctrl/Cmd を使用するか */
  meta: boolean;
  /** Shift を使用するか */
  shift: boolean;
  /** Ctrl のみ（meta=false のとき） */
  ctrl: boolean;
};

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  {
    id: 'newTask',
    label: '新規タスク作成',
    key: 'N',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'dashboard',
    label: 'ダッシュボード',
    key: 'D',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'home',
    label: 'ホーム（タスク一覧）',
    key: 'H',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'kanban',
    label: 'カンバンビュー',
    key: 'K',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'calendar',
    label: 'カレンダー',
    key: 'L',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'focusMode',
    label: 'フォーカスモード',
    key: 'F',
    meta: true,
    shift: true,
    ctrl: false,
  },
  {
    id: 'shortcutHelp',
    label: 'ショートカットヘルプ',
    key: '/',
    meta: true,
    shift: false,
    ctrl: false,
  },
  {
    id: 'toggleAI',
    label: 'ノート+AI機能',
    key: 'E',
    meta: false,
    shift: false,
    ctrl: true,
  },
];

interface ShortcutState {
  shortcuts: ShortcutBinding[];
  updateShortcut: (id: ShortcutId, binding: Partial<ShortcutBinding>) => void;
  resetShortcut: (id: ShortcutId) => void;
  resetAll: () => void;
  getDefault: (id: ShortcutId) => ShortcutBinding | undefined;
  /** 重複チェック: 指定 id 以外で同じキーバインドが存在するか */
  findDuplicate: (
    id: ShortcutId,
    binding: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>,
  ) => ShortcutBinding | undefined;
}

function formatBindingKey(
  b: Pick<ShortcutBinding, 'key' | 'meta' | 'shift' | 'ctrl'>,
): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push('ctrl');
  if (b.meta) parts.push('meta');
  if (b.shift) parts.push('shift');
  parts.push(b.key.toUpperCase());
  return parts.join('+');
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      updateShortcut: (id, binding) =>
        set((state) => ({
          shortcuts: state.shortcuts.map((s) =>
            s.id === id ? { ...s, ...binding } : s,
          ),
        })),
      resetShortcut: (id) =>
        set((state) => {
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === id);
          if (!def) return state;
          return {
            shortcuts: state.shortcuts.map((s) =>
              s.id === id ? { ...def } : s,
            ),
          };
        }),
      resetAll: () =>
        set({ shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })) }),
      getDefault: (id) => DEFAULT_SHORTCUTS.find((s) => s.id === id),
      findDuplicate: (id, binding) => {
        const key = formatBindingKey(binding);
        return get().shortcuts.find(
          (s) => s.id !== id && formatBindingKey(s) === key,
        );
      },
    }),
    {
      name: 'shortcut-bindings-storage',
    },
  ),
);

export { DEFAULT_SHORTCUTS, formatBindingKey };
