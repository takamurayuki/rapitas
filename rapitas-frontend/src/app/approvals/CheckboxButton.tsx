/**
 * CheckboxButton
 *
 * Shared styled checkbox button used in ApprovalCard and the select-all row.
 * Renders a violet filled checkbox when checked, an empty bordered box otherwise.
 */
'use client';

interface CheckboxButtonProps {
  checked: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * Renders a checkbox-style toggle button.
 *
 * @param checked - Whether the checkbox is selected / <チェック状態かどうか>
 * @param onClick - Click handler / <クリック時のコールバック>
 * @param className - Additional Tailwind utility classes / <追加Tailwindクラス>
 */
export function CheckboxButton({ checked, onClick, className = '' }: CheckboxButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
        checked
          ? 'border-violet-500 bg-violet-500'
          : 'border-zinc-300 dark:border-zinc-600'
      } ${className}`}
    >
      {checked && (
        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12">
          <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
        </svg>
      )}
    </button>
  );
}
