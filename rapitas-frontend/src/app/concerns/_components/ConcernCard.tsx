'use client';

/**
 * ConcernCard
 *
 * Renders one concern row: type/severity/status badges, the GitHub-issue link
 * badge, and the action buttons (convert / publish / dismiss / delete).
 * Stateless except for the inline repo picker used when publishing.
 */

import { useState } from 'react';
import {
  ListPlus,
  Trash2,
  ArrowRight,
  Loader2,
  Upload,
  CircleDot,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { TYPE_META, SEVERITY_META, type Concern, type GhIntegration } from './concern-shared';

interface ConcernCardProps {
  concern: Concern;
  busy: boolean;
  integrations: GhIntegration[];
  onConvert: (id: number) => void;
  onDismiss: (id: number, dismiss: boolean) => void;
  onDelete: (id: number) => void;
  /**
   * Publish the concern as a GitHub issue. Omit integrationId to let the server
   * resolve the target repo from the concern's theme; it resolves to
   * 'needs_picker' only when that fails (then pass an explicit integrationId).
   */
  onPublish: (
    id: number,
    integrationId?: number,
  ) => Promise<'published' | 'needs_picker' | 'error'>;
}

/** A single concern card with bridge-aware actions and badges. */
export function ConcernCard({
  concern: c,
  busy,
  integrations,
  onConvert,
  onDismiss,
  onDelete,
  onPublish,
}: ConcernCardProps) {
  const TyIcon = TYPE_META[c.type].icon;
  // Repo picker is only shown when there is more than one integration to choose.
  const [picking, setPicking] = useState(false);
  const [repoId, setRepoId] = useState<number | null>(integrations[0]?.id ?? null);

  const publish = async () => {
    // User already chose a repo from the fallback picker.
    if (picking && repoId != null) {
      await onPublish(c.id, repoId);
      setPicking(false);
      return;
    }
    // Default: publish directly — the server resolves the repo from the
    // concern's theme, so no picker is needed. Only fall back to picking when
    // the theme can't identify a repo (multiple repos) or to the sole repo.
    const result = await onPublish(c.id);
    if (result === 'needs_picker') {
      if (integrations.length === 1) {
        await onPublish(c.id, integrations[0].id);
      } else {
        setPicking(true);
      }
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_META[c.type].badge}`}
            >
              <TyIcon className="h-2.5 w-2.5" />
              {TYPE_META[c.type].label}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_META[c.severity].badge}`}
            >
              優先度 {SEVERITY_META[c.severity].label}
            </span>
            {c.status === 'task_created' && c.createdTaskId && (
              <a
                href={`/tasks/${c.createdTaskId}`}
                className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:underline dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                タスク化済 #{c.createdTaskId}
              </a>
            )}
            {c.status === 'resolved' && (
              <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="h-2.5 w-2.5" />
                完了
              </span>
            )}
            {c.status === 'dismissed' && (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                却下
              </span>
            )}
            {/* GitHub publish link badge */}
            {c.linkedIssue && (
              <a
                href={c.linkedIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                title="GitHub Issue を開く"
                className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium hover:underline ${
                  c.linkedIssue.state === 'closed'
                    ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                <CircleDot className="h-2.5 w-2.5" />#{c.linkedIssue.issueNumber}
                {c.linkedIssue.state === 'closed' ? ' · closed' : ''}
                <ExternalLink className="h-2 w-2" />
              </a>
            )}
            <span className="ml-auto text-[10px] text-zinc-400">
              {new Date(c.createdAt).toLocaleDateString('ja-JP')}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
            {c.detail}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
            {c.location && (
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
                {c.location}
              </code>
            )}
            {c.originTaskId && (
              <a href={`/tasks/${c.originTaskId}`} className="hover:underline">
                発見元 #{c.originTaskId}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
        {c.status === 'open' && (
          <button
            onClick={() => onConvert(c.id)}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
            タスク化
          </button>
        )}
        {/* Publish to GitHub — only for open, not-yet-published concerns */}
        {c.status === 'open' && !c.linkedIssue && integrations.length > 0 && (
          <div className="flex items-center gap-1">
            {picking && integrations.length > 1 && (
              <select
                value={repoId ?? ''}
                onChange={(e) => setRepoId(e.target.value ? parseInt(e.target.value) : null)}
                className="rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-[10px] outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
              >
                {integrations.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.ownerName}/{it.repositoryName}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={publish}
              disabled={busy}
              title="GitHub Issue として公開"
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {picking && integrations.length > 1 ? '公開する' : 'GitHubに公開'}
            </button>
          </div>
        )}
        {c.status === 'open' && (
          <button
            onClick={() => onDismiss(c.id, true)}
            disabled={busy}
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            却下
          </button>
        )}
        {c.status === 'dismissed' && (
          <button
            onClick={() => onDismiss(c.id, false)}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <ArrowRight className="h-3 w-3" />
            未対応に戻す
          </button>
        )}
        <button
          onClick={() => onDelete(c.id)}
          disabled={busy}
          title="削除"
          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
