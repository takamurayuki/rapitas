'use client';
/**
 * SettingsModalNav
 *
 * The settings modal's section list: a vertical sidebar from md up, a
 * horizontally scrolling tab row below it. Selection only — the modal shell
 * owns open/close and the content pane.
 */
import { useTranslations } from 'next-intl';
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from './settings-modal-store';
import { SETTINGS_SECTIONS } from './settings-sections';

interface SettingsModalNavProps {
  /** The section currently shown. */
  active: SettingsSectionId;
  /** Called with the section the user picked. */
  onSelect: (section: SettingsSectionId) => void;
}

/**
 * Renders one button per settings section.
 *
 * @param active - Section currently shown / 表示中の項目
 * @param onSelect - Selection handler / 選択時の処理
 */
export function SettingsModalNav({ active, onSelect }: SettingsModalNavProps) {
  const t = useTranslations('settings');

  return (
    <nav
      aria-label={t('layout.navAriaLabel')}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-2 scrollbar-thin md:w-56 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:px-3 md:py-3 dark:border-zinc-800"
    >
      {SETTINGS_SECTION_IDS.map((id) => {
        const { icon: Icon, labelKey } = SETTINGS_SECTIONS[id];
        const selected = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-current={selected ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              selected
                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
