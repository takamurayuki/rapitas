'use client';
/**
 * HelpTip
 *
 * A small ? beside a field's label that shows the field's explanation on
 * hover, keyboard focus or tap, so a form shows its fields and keeps the
 * details one step away. Escape or leaving closes it.
 * Not responsible for the label itself or for long help pages.
 */
import { useId, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * @param props.label - Accessible name of the button, e.g. "成果物の説明" / ボタンの名前
 * @param props.children - The explanation / 説明
 * @param props.align - Which edge the bubble lines up with / 吹き出しの揃え位置
 */
export function HelpTip({
  label,
  children,
  align = 'start',
}: {
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hover || pinned || focused;
  const close = () => {
    setHover(false);
    setPinned(false);
    setFocused(false);
  };

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          // A tap toggles on its own state only: a click focuses the button
          // first, so testing `focused` here would close it on the first tap.
          if (pinned) {
            setPinned(false);
            setFocused(false);
            setHover(false);
          } else setPinned(true);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        className="ml-1 rounded-full text-zinc-400 hover:text-zinc-600 focus-visible:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-20 mt-1.5 w-72 max-w-[80vw] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
