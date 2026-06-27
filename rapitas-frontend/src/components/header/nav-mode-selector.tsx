'use client';
/**
 * header/nav-mode-selector.tsx
 *
 * Segmented control that switches the app navigation mode (all / development /
 * learning), making the previously-invisible app-mode filter discoverable and
 * adjustable. Reads and writes the persisted app-mode store directly.
 */

import { LayoutGrid, Code, GraduationCap } from 'lucide-react';
import { useAppModeStore, type AppMode } from '@/stores/app-mode-store';

/** One selectable mode with its label and icon. */
type ModeOption = {
  value: AppMode;
  label: string;
  icon: typeof LayoutGrid;
};

// Icons mirror the nav groups they gate (Code = development, GraduationCap =
// learning) so the same glyph keeps the same meaning app-wide (ICON_POLICY).
const MODE_OPTIONS: ModeOption[] = [
  { value: 'all', label: 'すべて', icon: LayoutGrid },
  { value: 'development', label: '開発', icon: Code },
  { value: 'learning', label: '学習', icon: GraduationCap },
];

/**
 * Renders the navigation mode switcher used at the top of the side nav.
 *
 * Switching mode hides the mode-gated nav groups (development / learning);
 * core groups without a mode are always shown, so no destination is lost.
 */
export function NavModeSelector() {
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);

  return (
    <div className="px-4 pt-3 pb-1">
      <div
        role="group"
        aria-label="表示モード"
        className="flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 p-1"
      >
        {MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
          const isActive = mode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={isActive}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? 'bg-white dark:bg-indigo-dark-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 px-0.5 text-[11px] leading-tight text-zinc-400 dark:text-zinc-500">
        メニューの表示範囲を切り替えます
      </p>
    </div>
  );
}
