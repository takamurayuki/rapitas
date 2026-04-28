'use client';
// PaidLeaveOptions

import { Bell, ChevronDown } from 'lucide-react';

const REMINDER_OPTIONS = [
  { value: null, label: 'なし' },
  { value: 5, label: '5分前' },
  { value: 10, label: '10分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '1日前' },
];

const COLOR_OPTIONS = [
  { value: '#FF6B6B', label: 'Pink Red' },
  { value: '#4ECDC4', label: 'Teal' },
  { value: '#45B7D1', label: 'Sky Blue' },
  { value: '#96CEB4', label: 'Mint Green' },
  { value: '#FFEAA7', label: 'Light Yellow' },
  { value: '#DDA0DD', label: 'Plum' },
  { value: '#98D8C8', label: 'Seafoam' },
  { value: '#F7DC6F', label: 'Light Gold' },
];

type PaidLeaveOptionsProps = {
  showOptions: boolean;
  onToggleOptions: () => void;
  color: string;
  onColorChange: (value: string) => void;
  reminderMinutes: number | null;
  onReminderChange: (value: number | null) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
};

/**
 * Collapsible options section of the PaidLeaveDialog.
 *
 * @param props - See PaidLeaveOptionsProps
 * @returns Toggle button and, when open, color/reminder/memo controls.
 */
export function PaidLeaveOptions({
  showOptions,
  onToggleOptions,
  color,
  onColorChange,
  reminderMinutes,
  onReminderChange,
  description,
  onDescriptionChange,
}: PaidLeaveOptionsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleOptions}
        className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${showOptions ? 'rotate-180' : ''}`}
        />
        {showOptions ? 'オプションを閉じる' : 'カラー・リマインド・メモ'}
      </button>

      {showOptions && (
        <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Inline color picker */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 dark:text-zinc-500 w-10 shrink-0">カラー</span>
            <div className="flex gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onColorChange(c.value)}
                  title={c.label}
                  className={`w-6 h-6 rounded-full transition-all ${
                    color === c.value
                      ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-800 scale-110'
                      : 'hover:scale-110'
                  }`}
                  style={{
                    backgroundColor: c.value,
                    ...(color === c.value ? { ['--tw-ring-color' as string]: c.value } : {}),
                  }}
                />
              ))}
            </div>
          </div>

          {/* Inline reminder selector */}
          <div className="flex items-center gap-3">
            <Bell className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0 ml-0.5" />
            <div className="flex gap-1.5 flex-wrap">
              {REMINDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value === null ? 'null' : opt.value}
                  type="button"
                  onClick={() => onReminderChange(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    reminderMinutes === opt.value
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700'
                      : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Memo textarea */}
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="理由や備考を入力..."
            rows={2}
            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 text-sm resize-none transition-all"
          />
        </div>
      )}
    </>
  );
}
