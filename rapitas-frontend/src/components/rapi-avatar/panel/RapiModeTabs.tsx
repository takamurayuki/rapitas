'use client';
/**
 * RapiModeTabs
 *
 * The one row of shortcuts above ラピ's content.
 *
 * Four text tabs did not fit: measured in the live 320px bubble they wrapped
 * onto two lines and cost 49px before any content. Only the mode you are in
 * carries its label now; the rest are their glyph plus a tooltip, which
 * holds the row to one line and keeps it that way as modes are added.
 *
 * The mode you are in is always shown even when it has no tab of its own —
 * `roadmap` is reachable only by typing, and a bar that silently omitted it
 * would leave you unable to see where you had landed.
 */
import { useTranslations } from 'next-intl';
import { MODE_ICONS, type PanelMode } from './rapi-modes';

interface Props {
  /** The modes that get a permanent button. / 常設タブ */
  modes: readonly PanelMode[];
  /** Where we are now. / 現在のモード */
  mode: PanelMode;
  onSelect: (mode: PanelMode) => void;
}

/**
 * @param props - The modes to offer, the current one, and how to change it
 */
export function RapiModeTabs({ modes, mode, onSelect }: Props) {
  const tm = useTranslations('rapiAvatar.mode');
  // A typed-only mode has no button, so it is added at the front rather than
  // left out — otherwise nothing on screen says which mode you are in.
  const shown: readonly PanelMode[] = modes.includes(mode) ? modes : [mode, ...modes];

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-200 px-2 pt-1.5 dark:border-zinc-700">
      {shown.map((value) => {
        const Icon = MODE_ICONS[value];
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            // Toggle buttons, not a WAI-ARIA tablist: the content below is
            // not wired as tabpanels and there is no arrow-key navigation,
            // so claiming the roles would describe something that is not
            // there. `data-rapi-mode-tab` is what identifies them instead.
            data-rapi-mode-tab={value}
            onClick={() => onSelect(value)}
            aria-pressed={active}
            // The label is the tooltip when it is not on screen, so a glyph
            // is never the only thing identifying a mode.
            title={tm(value)}
            aria-label={tm(value)}
            className={`flex items-center gap-1 rounded-t-md px-1.5 py-1 text-xs transition-colors ${
              active
                ? 'bg-zinc-100 font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {active && <span className="whitespace-nowrap">{tm(value)}</span>}
          </button>
        );
      })}
    </div>
  );
}
