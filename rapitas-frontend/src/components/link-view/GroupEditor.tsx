'use client';
/**
 * GroupEditor
 *
 * The small panel for a group's name and colour, as a browser shows when
 * you edit a tab group. Shared by the tab strip's group chip and the
 * saved-pages library, because a group is one thing in both places.
 *
 * Draws and reports; the stores own the group.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { GROUP_COLORS } from '@/stores/link-library-store';

interface GroupEditorProps {
  name: string;
  color: string;
  /** Applied as the field changes, the way a browser applies it live. / 即時反映 */
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  /** Dismiss the panel. / 閉じる */
  onDone: () => void;
}

/**
 * @param props - The group's current name and colour, and what to do with edits
 */
export function GroupEditor({ name, color, onRename, onRecolor, onDone }: GroupEditorProps) {
  const t = useTranslations('linkView');
  // Local while typing so the field does not fight the user; the store is
  // still updated on every keystroke, which is what makes the chip follow
  // along as a browser's does.
  const [draft, setDraft] = useState(name);

  // Focused on open, as a browser's group editor is. Via a ref rather than
  // `autoFocus`, which the a11y rule rejects for good reason in general —
  // this is a panel the user deliberately opened to type a name into.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="flex w-52 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <input
        ref={field}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onRename(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone();
          // Esc closes the pane at the window level; here it should only
          // dismiss this panel.
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone();
          }
        }}
        placeholder={t('groupNamePlaceholder')}
        aria-label={t('groupNamePlaceholder')}
        className="min-w-0 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-200"
      />
      <div className="flex flex-wrap gap-1">
        {GROUP_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onRecolor(swatch)}
            aria-label={swatch}
            aria-pressed={swatch === color}
            className="flex h-5 w-5 items-center justify-center rounded-full ring-offset-1 transition-transform hover:scale-110 dark:ring-offset-zinc-900"
            style={{ backgroundColor: swatch }}
          >
            {swatch === color && <Check className="h-3 w-3 text-white" />}
          </button>
        ))}
      </div>
    </div>
  );
}
