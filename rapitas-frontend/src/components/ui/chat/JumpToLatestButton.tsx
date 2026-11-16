/**
 * JumpToLatestButton
 *
 * The translucent round ▽ that floats at the bottom right of a chat log
 * while the reader is scrolled away from the newest line. Pressing it is
 * the caller's scroll (see `useChatFollow`); this only draws the button.
 * Place it inside a `relative` box that wraps the scrolling log.
 */
import { ChevronDown } from 'lucide-react';

interface JumpToLatestButtonProps {
  /** Scrolls the log to its newest line. / 最新の行へスクロールする */
  onClick: () => void;
  /** Accessible name, e.g. "最新のメッセージへ". / 読み上げ用の名前 */
  label: string;
}

/**
 * @param props.onClick - Scrolls to the newest line / 最新の行へ移る
 * @param props.label - Accessible name / 読み上げ用の名前
 */
export function JumpToLatestButton({ onClick, label }: JumpToLatestButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-chat-jump="true"
      className="absolute right-3 bottom-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300/80 bg-white/75 text-zinc-600 shadow-md backdrop-blur-sm transition-colors duration-150 hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none dark:border-zinc-600/80 dark:bg-zinc-800/75 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <ChevronDown className="h-5 w-5" />
    </button>
  );
}
