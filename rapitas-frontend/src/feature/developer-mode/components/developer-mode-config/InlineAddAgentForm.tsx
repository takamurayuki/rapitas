'use client';

/**
 * InlineAddAgentForm
 *
 * Compact form rendered inside the agent selector for adding a new AI agent
 * without leaving the DeveloperModeConfig modal.
 */

import { X, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { validateName } from '@/utils/validation';

type Props = {
  /** Current name input value. / 名前の入力値 */
  name: string;
  onNameChange: (name: string, error: string | null) => void;
  nameError: string | null;
  /** Currently selected agent type. / 選択中のエージェント種別 */
  agentType: string;
  onAgentTypeChange: (type: string) => void;
  /** Whether to mark the new agent as default. / デフォルトに設定するか */
  isDefault: boolean;
  onIsDefaultChange: (v: boolean) => void;
  /** Submission error from the backend. / バックエンドからの送信エラー */
  error: string | null;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * Renders the inline agent creation form card.
 *
 * @param props - All controlled values and callbacks. / 制御値とコールバック一式
 */
export function InlineAddAgentForm({
  name,
  onNameChange,
  nameError,
  agentType,
  onAgentTypeChange,
  isDefault,
  onIsDefaultChange,
  error,
  isSaving,
  onSave,
  onCancel,
}: Props) {
  const handleNameInput = (raw: string) => {
    if (raw.trim()) {
      const result = validateName(raw, 'エージェント名', 1, 50);
      onNameChange(raw, result.valid ? null : (result.error ?? null));
    } else {
      onNameChange(raw, null);
    }
  };

  return (
    <div className="mt-3 p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            エージェントを追加
          </span>
        </div>
        <button
          onClick={onCancel}
          className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameInput(e.target.value)}
          placeholder="例: メイン開発エージェント"
          className={`w-full px-2.5 py-1.5 bg-white dark:bg-indigo-dark-900 border rounded text-xs focus:outline-none focus:ring-2 transition-all ${
            nameError
              ? 'border-red-400 dark:border-red-600 focus:ring-red-500/20'
              : 'border-zinc-200 dark:border-zinc-700 focus:ring-violet-500/20 focus:border-violet-500'
          }`}
        />
        {nameError && (
          <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {nameError}
          </p>
        )}

        <select
          value={agentType}
          onChange={(e) => onAgentTypeChange(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="gemini">Gemini CLI</option>
        </select>

        <label className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => onIsDefaultChange(e.target.checked)}
            className="w-3 h-3 text-violet-600 border-zinc-300 rounded focus:ring-violet-500"
          />
          デフォルトに設定
        </label>
      </div>

      {error && (
        <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={!name.trim() || isSaving}
          className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          追加
        </button>
      </div>
    </div>
  );
}
