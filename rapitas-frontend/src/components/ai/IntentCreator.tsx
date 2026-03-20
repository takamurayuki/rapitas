'use client';

/**
 * IntentCreator
 *
 * UI for creating tasks from declarative .intent files.
 * Provides a template editor with preview of the compiled output.
 */
import React, { useState, useCallback } from 'react';
import { FileText, Play, Eye, AlertCircle, CheckCircle, Sparkles } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

const INTENT_TEMPLATE = `title:
priority: medium
hours: 4
mode: standard

@goals
-

@constraints
-

@acceptance
- Tests pass
- No breaking changes

@hints
-
`;

type ParsePreview = {
  intent: {
    title: string;
    goals: string[];
    constraints: string[];
    workflow: { mode: string; autoApprove: boolean };
  };
  compiled: {
    taskData: { title: string; workflowMode: string };
    planPreview: string;
    promptPreview: string;
  };
  warnings: string[];
};

type Props = {
  themeId?: number;
  onCreated?: (taskId: number) => void;
};

export function IntentCreator({ themeId, onCreated }: Props) {
  const [content, setContent] = useState(INTENT_TEMPLATE);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ taskId: number; title: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handlePreview = useCallback(async () => {
    setErrors([]);
    try {
      const res = await fetch(`${API_BASE_URL}/intent/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.success) {
        setPreview(data.data);
        setShowPreview(true);
      } else {
        setErrors(data.errors || ['Parse failed']);
      }
    } catch {
      setErrors(['Failed to connect to server']);
    }
  }, [content]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setErrors([]);
    try {
      const res = await fetch(`${API_BASE_URL}/intent/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, themeId }),
      });
      const data = await res.json();
      if (data.success) {
        setCreated({ taskId: data.data.taskId, title: data.data.title });
        onCreated?.(data.data.taskId);
      } else {
        setErrors(data.errors || [data.error || 'Creation failed']);
      }
    } catch {
      setErrors(['Failed to connect to server']);
    } finally {
      setCreating(false);
    }
  }, [content, themeId, onCreated]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30">
        <Sparkles className="w-4 h-4 text-violet-500" />
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Intent-Driven Development
        </span>
        <span className="ml-auto text-xs text-zinc-400">
          宣言的にタスクを定義
        </span>
      </div>

      {created ? (
        <div className="p-6 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
            タスク #{created.taskId} を作成しました
          </h3>
          <p className="text-sm text-zinc-500 mt-1">{created.title}</p>
          <div className="mt-4 flex justify-center gap-2">
            <a
              href={`/tasks?taskId=${created.taskId}`}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              タスクを開く
            </a>
            <button
              onClick={() => { setCreated(null); setContent(INTENT_TEMPLATE); }}
              className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              新規作成
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Editor */}
          <div className="p-4">
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setShowPreview(false); }}
              rows={16}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-y"
              placeholder="title: My Feature&#10;@goals&#10;- Implement..."
            />
          </div>

          {/* Preview */}
          {showPreview && preview && (
            <div className="mx-4 mb-4 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800">
              <h4 className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
                Preview
              </h4>
              <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                <p><strong>Title:</strong> {preview.intent.title}</p>
                <p><strong>Mode:</strong> {preview.intent.workflow.mode}</p>
                <p><strong>Goals:</strong> {preview.intent.goals.length}件</p>
                <p><strong>Constraints:</strong> {preview.intent.constraints.length}件</p>
                {preview.warnings.length > 0 && (
                  <p className="text-amber-600">⚠️ {preview.warnings.join(', ')}</p>
                )}
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="mx-4 mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {e}
                </p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={handlePreview}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !content.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              {creating ? 'Creating...' : 'タスクを作成'}
            </button>
          </div>

          {/* Help */}
          <div className="px-4 pb-4">
            <details className="text-xs text-zinc-400">
              <summary className="cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300">
                .intent ファイルの書き方
              </summary>
              <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg font-mono space-y-1">
                <p>title: タスク名</p>
                <p>priority: low | medium | high | urgent</p>
                <p>hours: 推定時間</p>
                <p>mode: lightweight | standard | comprehensive</p>
                <p>autoApprove: true | false</p>
                <p className="mt-2">@goals (達成すべきこと)</p>
                <p>@constraints (守るべき制約)</p>
                <p>@acceptance (受入基準)</p>
                <p>@hints (実装ヒント)</p>
                <p>@dependencies (前提条件)</p>
              </div>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
