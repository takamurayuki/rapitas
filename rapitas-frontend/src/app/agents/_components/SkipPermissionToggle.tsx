/**
 * SkipPermissionToggle
 *
 * Card on /agents that controls whether CLI agents (Claude Code / Codex /
 * Gemini) get spawned with their permission-bypass flags
 * (`--dangerously-skip-permissions`, `--yolo`). When ON the agent never
 * stops mid-execution to prompt the user; when OFF the native CLI prompt
 * surfaces, which is safer but interrupts long-running tasks.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { ShieldOff, ShieldCheck } from 'lucide-react';
import type { UserSettings } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { Toggle } from '@/components/ui/Toggle';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SkipPermissionToggle');

export function SkipPermissionToggle() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (res.ok && !cancelled) setSettings(await res.json());
      } catch (err) {
        logger.error('Failed to load settings', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = useCallback(async (next: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipAgentPermissionPrompts: next }),
      });
      if (res.ok) {
        setSettings((prev) => (prev ? { ...prev, skipAgentPermissionPrompts: next } : prev));
      }
    } catch (err) {
      logger.error('Failed to save', err);
    } finally {
      setBusy(false);
    }
  }, []);

  const checked = settings?.skipAgentPermissionPrompts ?? true;
  const Icon = checked ? ShieldOff : ShieldCheck;
  const tone = checked
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              エージェントの許可確認をスキップ
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {checked ? (
                <>
                  Claude Code には{' '}
                  <code className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                    --dangerously-skip-permissions
                  </code>
                  、Codex / Gemini には{' '}
                  <code className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                    --yolo
                  </code>{' '}
                  を付けて起動します。実行が止まりませんが、ファイル編集やコマンド実行を即座に行うので注意。
                </>
              ) : (
                <>
                  CLI 標準の許可プロンプトを surface
                  します。安全ですが、実行中に質問が来るたびタスクが一時停止します。
                </>
              )}
            </p>
          </div>
        </div>
        <Toggle
          checked={checked}
          onChange={onToggle}
          disabled={busy}
          color={checked ? 'amber' : 'green'}
          srLabel="エージェント許可確認スキップ"
        />
      </div>
    </div>
  );
}
