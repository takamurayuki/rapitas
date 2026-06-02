'use client';
/**
 * WorkflowModesConfig
 *
 * Editor for the per-complexity-tier workflow definitions (軽量/標準/詳細).
 * Each tier's optional phases (plan / review / auto-verify) and complexity
 * range are configurable; the backend derives the actual phase sequence from
 * these settings (single source of truth — workflow-mode-config.ts).
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { Toggle } from '@/components/ui/Toggle';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WorkflowModesConfig');

type ModeKey = 'lightweight' | 'standard' | 'comprehensive';

interface ModeSettings {
  mode: ModeKey;
  includePlan: boolean;
  includeReview: boolean;
  autoVerify: boolean;
  complexityMin: number;
  complexityMax: number;
  isEnabled: boolean;
  phases: string[];
}

const MODE_META: Record<ModeKey, { label: string; tier: string; desc: string }> = {
  lightweight: { label: '軽量', tier: '低', desc: 'バグ修正・UI調整・軽微な変更' },
  standard: { label: '標準', tier: '中', desc: '中規模の機能追加・リファクタリング' },
  comprehensive: { label: '詳細', tier: '高', desc: '大規模機能・アーキテクチャ変更' },
};

const PHASE_LABEL: Record<string, string> = {
  researcher: '調査',
  planner: '計画',
  reviewer: 'レビュー',
  implementer: '実装',
  verifier: '検証',
  auto_verifier: '自動検証',
};

/** Derive the ordered phase chips from the current toggles (client preview). */
function previewPhases(s: ModeSettings): string[] {
  const phases = ['調査'];
  if (s.includePlan) {
    phases.push('計画');
    if (s.includeReview) phases.push('レビュー');
  }
  phases.push('実装', s.autoVerify ? '自動検証' : '検証');
  return phases;
}

/**
 * Workflow mode configuration panel. Fetches all tiers and saves edits inline.
 *
 * @returns The mode-config section JSX. / モード設定セクション
 */
export default function WorkflowModesConfig() {
  const [modes, setModes] = useState<ModeSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingMode, setSavingMode] = useState<ModeKey | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow-modes`);
        if (res.ok) {
          const data = await res.json();
          setModes(data.modes ?? []);
        }
      } catch (err) {
        logger.error('Failed to load workflow modes:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const save = useCallback(async (mode: ModeKey, patch: Partial<ModeSettings>) => {
    setSavingMode(mode);
    // Optimistic update.
    setModes((prev) => prev.map((m) => (m.mode === mode ? { ...m, ...patch } : m)));
    try {
      const res = await fetch(`${API_BASE_URL}/workflow-modes/${mode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mode) {
          setModes((prev) => prev.map((m) => (m.mode === mode ? { ...m, ...data.mode } : m)));
        }
      }
    } catch (err) {
      logger.error('Failed to save workflow mode:', err);
    } finally {
      setSavingMode(null);
    }
  }, []);

  if (isLoading) {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400">読み込み中...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        複雑度スコアに応じて適用されるワークフローを設定します。各ティアで実行するフェーズ（計画・レビュー・自動検証）と、適用される複雑度の範囲を編集できます。
      </p>

      {modes.map((m) => {
        const meta = MODE_META[m.mode];
        const phases = previewPhases(m);
        return (
          <div
            key={m.mode}
            className={`rounded-lg border p-4 transition-colors ${
              m.isEnabled
                ? 'border-zinc-200 dark:border-zinc-700'
                : 'border-zinc-200/60 dark:border-zinc-800 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  {meta?.tier}
                </span>
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {meta?.label}
                    {savingMode === m.mode && (
                      <span className="ml-2 text-[10px] text-zinc-400">保存中...</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{meta?.desc}</div>
                </div>
              </div>
              <Toggle
                checked={m.isEnabled}
                onChange={(v) => save(m.mode, { isEnabled: v })}
                srLabel={`${meta?.label}を有効化`}
                color="green"
              />
            </div>

            {/* Phase preview */}
            <div className="flex flex-wrap items-center gap-1 mb-3">
              {phases.map((p, i) => (
                <span key={`${p}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-600 text-xs">→</span>}
                  <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                    {p}
                  </span>
                </span>
              ))}
            </div>

            {/* Phase toggles */}
            <div className="grid gap-2 sm:grid-cols-3 mb-3">
              <Toggle
                checked={m.includePlan}
                onChange={(v) =>
                  save(m.mode, v ? { includePlan: true } : { includePlan: false, includeReview: false })
                }
                label="計画フェーズ"
                size="sm"
              />
              <Toggle
                checked={m.includeReview}
                onChange={(v) => save(m.mode, { includeReview: v })}
                label="レビューフェーズ"
                description={!m.includePlan ? '計画フェーズが必要' : undefined}
                disabled={!m.includePlan}
                size="sm"
              />
              <Toggle
                checked={m.autoVerify}
                onChange={(v) => save(m.mode, { autoVerify: v })}
                label="自動検証"
                size="sm"
              />
            </div>

            {/* Complexity range */}
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>複雑度範囲</span>
              <input
                type="number"
                min={0}
                max={100}
                value={m.complexityMin}
                onChange={(e) => save(m.mode, { complexityMin: Number(e.target.value) })}
                className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                aria-label={`${meta?.label}の複雑度下限`}
              />
              <span>〜</span>
              <input
                type="number"
                min={0}
                max={100}
                value={m.complexityMax}
                onChange={(e) => save(m.mode, { complexityMax: Number(e.target.value) })}
                className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                aria-label={`${meta?.label}の複雑度上限`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
