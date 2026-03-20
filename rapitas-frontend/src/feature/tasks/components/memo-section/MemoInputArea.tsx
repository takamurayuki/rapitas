/**
 * MemoInputArea
 *
 * Renders the memo type selector buttons, template trigger, the main textarea,
 * and the submit button. Purely presentational — state is owned by MemoSection.
 */

'use client';

import { Loader2, Plus, Zap } from 'lucide-react';
import type { MemoType } from './types';
import { MEMO_TYPE_CONFIG } from './types';

type MemoInputAreaProps = {
  newComment: string;
  isAddingComment: boolean;
  selectedMemoType: MemoType;
  onNewCommentChange: (v: string) => void;
  onSelectedMemoTypeChange: (t: MemoType) => void;
  onSubmit: () => void;
  onOpenTemplates: () => void;
};

/**
 * Renders the memo type selector, template button, textarea, and submit button.
 *
 * @param newComment - Controlled textarea value / テキストエリアの値
 * @param isAddingComment - Disables controls while submission is in-flight / 送信中フラグ
 * @param selectedMemoType - Active memo type / 選択中のメモ種別
 * @param onNewCommentChange - Updates newComment in the parent / テキスト更新コールバック
 * @param onSelectedMemoTypeChange - Updates selectedMemoType / メモ種別更新コールバック
 * @param onSubmit - Triggers comment submission / 送信コールバック
 * @param onOpenTemplates - Opens the template selector modal / テンプレート選択を開くコールバック
 */
export function MemoInputArea({
  newComment,
  isAddingComment,
  selectedMemoType,
  onNewCommentChange,
  onSelectedMemoTypeChange,
  onSubmit,
  onOpenTemplates,
}: MemoInputAreaProps) {
  return (
    <div className="space-y-2 mb-3">
      {/* Memo Type Selector & Template Button */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-zinc-500">種類:</span>
        <div className="flex gap-1">
          {(Object.keys(MEMO_TYPE_CONFIG) as MemoType[]).map((type) => {
            const config = MEMO_TYPE_CONFIG[type];
            const Icon = config.icon;
            const isSelected = selectedMemoType === type;

            return (
              <button
                key={type}
                onClick={() => onSelectedMemoTypeChange(type)}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                  isSelected
                    ? `${config.color.badge} border-current`
                    : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                <Icon className="w-2.5 h-2.5" />
                {config.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <button
          onClick={onOpenTemplates}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-full hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
          title="テンプレートを使用"
        >
          <Zap className="w-2.5 h-2.5" />
          テンプレート
        </button>
      </div>

      {/* Textarea + Submit */}
      <div className="flex gap-1.5">
        <div className="flex-1 space-y-1">
          <textarea
            value={newComment}
            onChange={(e) => onNewCommentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={`${MEMO_TYPE_CONFIG[selectedMemoType].label}メモを追加...（Shift+Enterで改行）`}
            className={`w-full px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border rounded-lg outline-none focus:ring-1 placeholder:text-zinc-400 resize-none transition-colors ${
              selectedMemoType !== 'general'
                ? `${MEMO_TYPE_CONFIG[selectedMemoType].color.border} focus:border-current focus:ring-current/30`
                : 'border-zinc-200 dark:border-zinc-700 focus:border-blue-400 focus:ring-blue-400/30'
            }`}
            disabled={isAddingComment}
            rows={2}
          />
        </div>
        <button
          onClick={onSubmit}
          disabled={!newComment.trim() || isAddingComment}
          className="self-stretch px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 transition-colors"
        >
          {isAddingComment ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
