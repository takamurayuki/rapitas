'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Keyboard } from 'lucide-react';
import { useShortcutStore, type ShortcutId } from '@/stores/shortcutStore';
import { useNoteStore } from '@/stores/noteStore';

const getIsMac = () => {
  if (typeof window === 'undefined') return false;
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
};

export const OPEN_SHORTCUTS_EVENT = 'openKeyboardShortcuts';

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);
  const [isMac, _setIsMac] = useState(() => getIsMac());
  const shortcuts = useShortcutStore((state) => state.shortcuts);

  useEffect(() => {
    const handleOpenShortcuts = () => setShowHelp(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, handleOpenShortcuts);
    return () =>
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, handleOpenShortcuts);
  }, []);

  const actionMap: Record<ShortcutId, () => void> = {
    newTask: () => router.push('/tasks/new'),
    dashboard: () => router.push('/dashboard'),
    home: () => router.push('/'),
    kanban: () => router.push('/kanban'),
    calendar: () => router.push('/calendar'),
    focusMode: () => router.push('/focus'),
    shortcutHelp: () => setShowHelp(true),
    toggleAI: () => {
      const noteStore = useNoteStore.getState();
      if (noteStore.modalState.isOpen) {
        noteStore.setModalTab(
          noteStore.modalState.activeTab === 'ai' ? 'note' : 'ai',
        );
      } else {
        noteStore.openModal('ai');
      }
    },
    commandBar: () => {
      // SmartCommandBar handles its own keyboard shortcut
    },
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }

      for (const binding of shortcuts) {
        // NOTE: When only ctrl is specified, match ctrlKey alone without metaKey
        const ctrlOnly = binding.ctrl && !binding.meta;
        const metaMatch = ctrlOnly
          ? e.ctrlKey && !e.metaKey
          : binding.meta
            ? e.metaKey || e.ctrlKey
            : !(e.metaKey || e.ctrlKey);
        const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
        const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase();

        if (metaMatch && shiftMatch && keyMatch) {
          e.preventDefault();
          const action = actionMap[binding.id];
          if (action) action();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, shortcuts, showHelp]);

  const formatShortcut = (binding: {
    key: string;
    meta: boolean;
    shift: boolean;
    ctrl: boolean;
  }) => {
    const parts = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.meta) parts.push(isMac ? '\u2318' : 'Ctrl');
    if (binding.shift) parts.push(isMac ? '\u21E7' : 'Shift');
    parts.push(
      !binding.key
        ? ''
        : binding.key === 'Escape'
          ? 'Esc'
          : binding.key.toUpperCase(),
    );
    return parts.join(' + ');
  };

  if (!showHelp) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => setShowHelp(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-indigo-500" />
            <h2
              id="keyboard-shortcuts-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              キーボードショートカット
            </h2>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {shortcuts.map((binding) => (
            <div
              key={binding.id}
              className="flex items-center justify-between py-2"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {binding.label}
              </span>
              <kbd className="px-2 py-1 bg-zinc-100 dark:bg-zinc-700 rounded text-xs font-mono text-zinc-600 dark:text-zinc-400">
                {formatShortcut(binding)}
              </kbd>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isMac
              ? '\u2318 は Command キー、\u21E7 は Shift キー'
              : 'Ctrl は Control キー'}
          </p>
        </div>
      </div>
    </div>
  );
}
