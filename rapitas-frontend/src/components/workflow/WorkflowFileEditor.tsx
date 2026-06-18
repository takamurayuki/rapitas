'use client';
// WorkflowFileEditor

import { useState } from 'react';
import { Loader2, Eye, Pencil, X, Check } from 'lucide-react';
import type { WorkflowFileType } from '@/types';
import { MarkdownView } from '../markdown/MarkdownView';
import { useWorkflowFileSave } from '@/hooks/workflow/useWorkflowFileSave';
import { useToast } from '../ui/toast/ToastContainer';

interface WorkflowFileEditorProps {
  taskId: number;
  fileType: WorkflowFileType;
  /** Current file content to seed the editor. / 編集の初期値 */
  initialContent: string;
  /** Called after a successful save so the parent can refetch. / 保存成功後の再取得 */
  onSaved: () => void;
  /** Called when the user cancels editing. / 編集キャンセル */
  onCancel: () => void;
}

/**
 * Inline editor for a workflow markdown file (used for plan.md before approval).
 * Provides a write/preview toggle and saves via the workflow API. Lets a human
 * refine the agent's plan instead of only approving/rejecting it wholesale.
 *
 * @param taskId - Task whose file is edited. / 対象タスク
 * @param fileType - Which workflow file (e.g. 'plan'). / ファイル種別
 * @param initialContent - Seed content. / 初期内容
 * @param onSaved - Refetch callback on save success. / 保存成功時の再取得
 * @param onCancel - Cancel callback. / キャンセル
 */
export function WorkflowFileEditor({
  taskId,
  fileType,
  initialContent,
  onSaved,
  onCancel,
}: WorkflowFileEditorProps) {
  const [draft, setDraft] = useState(initialContent);
  const [preview, setPreview] = useState(false);
  const { saveFile, isSaving } = useWorkflowFileSave(taskId);
  const { showToast } = useToast();

  const dirty = draft !== initialContent;

  const handleSave = async () => {
    const result = await saveFile(fileType, draft);
    if (result.success) {
      showToast('計画を保存しました', 'success');
      onSaved();
    } else {
      showToast(result.error || '保存に失敗しました', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span>{preview ? '編集に戻る' : 'プレビュー'}</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" />
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !dirty}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            保存
          </button>
        </div>
      </div>

      {preview ? (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <MarkdownView content={draft || '（内容なし）'} />
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="h-[60vh] w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 font-mono text-sm text-zinc-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
      )}
    </div>
  );
}
