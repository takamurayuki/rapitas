'use client';

/**
 * TaskAutomationSettings
 *
 * Per-task automation settings (auto-commit / auto-PR / auto-merge) shown on the
 * task detail. Replaces the abolished developer-mode config modal as the place to
 * enable auto-merge. Reads/writes AgentExecutionConfig via the
 * /agent-execution-config/:taskId endpoint; not responsible for running agents.
 */
import { useEffect, useState, useCallback } from 'react';
import { GitMerge } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { API_BASE_URL } from '@/utils/api';

interface AutomationState {
  autoCommit: boolean;
  autoCreatePR: boolean;
  autoMergePR: boolean;
  mergeCommitThreshold: number;
}

const DEFAULTS: AutomationState = {
  autoCommit: false,
  autoCreatePR: false,
  autoMergePR: false,
  mergeCommitThreshold: 5,
};

/**
 * Automation settings card for a single task.
 *
 * @param props.taskId - Task whose automation config is edited. / 設定対象タスクID
 */
export default function TaskAutomationSettings({ taskId }: { taskId: number }) {
  const [state, setState] = useState<AutomationState>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/agent-execution-config/${taskId}`);
        if (res.ok && !cancelled) {
          const d = (await res.json()) as Partial<AutomationState>;
          setState({
            autoCommit: !!d.autoCommit,
            autoCreatePR: !!d.autoCreatePR,
            autoMergePR: !!d.autoMergePR,
            mergeCommitThreshold: d.mergeCommitThreshold ?? 5,
          });
        }
      } catch {
        // No config yet (404) or network error — keep defaults.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Persist a partial change immediately. The backend upsert only updates the
  // provided fields, so a minimal body is safe and never clobbers other config.
  const save = useCallback(
    async (patch: Partial<AutomationState>) => {
      setState((prev) => ({ ...prev, ...patch }));
      setSaving(true);
      try {
        await fetch(`${API_BASE_URL}/agent-execution-config/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      } catch {
        // Best-effort; the next toggle re-sends.
      } finally {
        setSaving(false);
      }
    },
    [taskId],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">自動化設定</h3>
        {saving && <span className="text-xs text-zinc-400">保存中…</span>}
      </div>

      <div className={`space-y-3 ${loading ? 'pointer-events-none opacity-50' : ''}`}>
        <Toggle
          checked={state.autoCommit}
          onChange={(v) => save({ autoCommit: v })}
          label="自動コミット"
          description="完了時に変更を自動コミット"
        />
        <Toggle
          checked={state.autoCreatePR}
          onChange={(v) =>
            // Turning off auto-PR also disables auto-merge (nothing to merge).
            save(v ? { autoCreatePR: true } : { autoCreatePR: false, autoMergePR: false })
          }
          label="自動PR作成"
          description="完了時にPull Requestを自動作成"
        />

        {state.autoCreatePR && (
          <div className="ml-4 space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-700">
            <Toggle
              checked={state.autoMergePR}
              onChange={(v) => save({ autoMergePR: v })}
              label="自動マージ"
              description="PRのCIが緑になったら自動マージ（CI失敗時は自動修正→再CI）"
            />
            {state.autoMergePR && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Squashマージ閾値</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={state.mergeCommitThreshold}
                  onChange={(e) =>
                    save({ mergeCommitThreshold: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  コミット以上でsquash
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
