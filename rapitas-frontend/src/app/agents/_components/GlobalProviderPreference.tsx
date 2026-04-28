/**
 * GlobalProviderPreference
 *
 * Agent-management variant of the global "default AI provider" picker. The
 * `/settings` version gates each card on an API key being saved, but this
 * page is about *agents*, which can authenticate via the CLI (claude-code,
 * gemini-cli, codex-cli, …).
 *
 * Availability is sourced from `GET /agent-availability`, which runs the
 * model-discovery probes (CLI spawn / REST ping) — meaning a card lights up
 * only when the provider actually responds, not just because a row is
 * marked active in `AIAgentConfig`.
 *
 * Persists the selected provider into `UserSettings.defaultAiProvider`,
 * which the SmartModelRouter consults as a tier tiebreaker.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  CheckCircle,
  Cloud,
  Cpu,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { UserSettings, ApiProvider } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GlobalProviderPreference');

/** Backend probe key as returned by `/agent-availability`. */
type ProbeProvider = 'claude' | 'openai' | 'gemini' | 'ollama';

interface ProviderEntry {
  /** UI / settings key (matches `UserSettings.defaultAiProvider`). */
  key: ApiProvider;
  /** Probe key as returned by the backend. */
  probeKey: ProbeProvider;
  label: string;
  description: string;
  icon: typeof Cloud;
  iconColor: string;
}

const PROVIDERS: ProviderEntry[] = [
  {
    key: 'claude',
    probeKey: 'claude',
    label: 'Claude',
    description: 'Claude Code CLI',
    icon: Cloud,
    iconColor: 'text-orange-500',
  },
  {
    key: 'chatgpt',
    probeKey: 'openai',
    label: 'OpenAI / Codex',
    description: 'Codex CLI',
    icon: Cloud,
    iconColor: 'text-emerald-500',
  },
  {
    key: 'gemini',
    probeKey: 'gemini',
    label: 'Gemini',
    description: 'Gemini CLI',
    icon: Cloud,
    iconColor: 'text-blue-500',
  },
];

interface AvailabilityProvider {
  provider: ProbeProvider;
  available: boolean;
  reason: string | null;
  modelCount: number;
  sampleModels: Array<{ id: string; tier: string; source: string }>;
}

interface AvailabilityResponse {
  fetchedAt: string;
  providers: AvailabilityProvider[];
}

/** Provider keys we surface in the picker. */
const TRACKED_PROVIDER_KEYS: ProbeProvider[] = ['claude', 'openai', 'gemini'];

/** Cap for auto-retry after seeing an unavailable provider. */
const MAX_AUTO_RETRIES = 2;
/** Wait between auto-retries (gives Bun hot-reload / CLI startup a moment). */
const AUTO_RETRY_DELAY_MS = 2500;

export function GlobalProviderPreference() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [autoRetryCount, setAutoRetryCount] = useState(0);

  const loadAvailability = useCallback(async (force = false) => {
    setRefreshing(force);
    try {
      // cliOnly=1 — this page intentionally ignores API keys; only the CLI
      // tool's actual response counts as "available".
      const params = new URLSearchParams({ cliOnly: '1' });
      if (force) params.set('refresh', '1');
      const res = await fetch(
        `${API_BASE_URL}/agent-availability?${params.toString()}`,
      );
      if (res.ok) setAvailability(await res.json());
    } catch (err) {
      logger.error('Failed to load availability', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) setSettings(await res.json());
    } catch (err) {
      logger.error('Failed to load settings', err);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadAvailability();
  }, [loadAvailability, loadSettings]);

  // Auto-retry: when the first probe returns any unavailable provider, the
  // backend may simply have been mid-reload — silently re-fetch with cache
  // bust so the user does not have to press the manual button. Capped at
  // MAX_AUTO_RETRIES so a genuinely missing CLI does not loop forever.
  useEffect(() => {
    if (!availability) return;
    if (autoRetryCount >= MAX_AUTO_RETRIES) return;
    const anyMissing = availability.providers.some(
      (p) => TRACKED_PROVIDER_KEYS.includes(p.provider) && !p.available,
    );
    if (!anyMissing) return;
    const handle = window.setTimeout(() => {
      setAutoRetryCount((n) => n + 1);
      loadAvailability(true);
    }, AUTO_RETRY_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [availability, autoRetryCount, loadAvailability]);

  const onSelect = useCallback(async (provider: ApiProvider) => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAiProvider: provider }),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? { ...prev, defaultAiProvider: provider } : prev,
        );
      }
    } catch (err) {
      logger.error('Failed to save default provider', err);
    }
  }, []);

  const probeFor = (key: ProbeProvider): AvailabilityProvider | null =>
    availability?.providers.find((p) => p.provider === key) ?? null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-zinc-400" />
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              デフォルトエージェント
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              自動選択時の優先プロバイダ。ロール側で個別上書きされない場合に使われます
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setAutoRetryCount(0);
            loadAvailability(true);
          }}
          disabled={refreshing}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 disabled:opacity-50"
          title="CLI / API へ再 probe してキャッシュを破棄"
        >
          <RefreshCw
            className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
          />
          再チェック
        </button>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const probe = probeFor(p.probeKey);
            const isAvailable = probe?.available === true;
            const isSelected = settings?.defaultAiProvider === p.key;
            const Icon = p.icon;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => isAvailable && onSelect(p.key)}
                disabled={!isAvailable}
                className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                    : isAvailable
                      ? 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                      : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 opacity-60 cursor-not-allowed'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <CheckCircle className="w-5 h-5 text-violet-500" />
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <div
                    className={`p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${p.iconColor}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      className={`font-medium text-sm ${
                        isSelected
                          ? 'text-violet-700 dark:text-violet-300'
                          : isAvailable
                            ? 'text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-400 dark:text-zinc-600'
                      }`}
                    >
                      {p.label}
                    </h3>
                    <p
                      className={`text-xs mt-1 ${
                        isSelected
                          ? 'text-violet-500 dark:text-violet-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {p.description}
                    </p>
                    {availability == null ? (
                      <p className="text-[10px] mt-2 text-zinc-400">確認中…</p>
                    ) : isAvailable ? (
                      <p className="text-[10px] mt-2 text-emerald-600 dark:text-emerald-400">
                        ✓ 応答あり ({probe?.modelCount ?? 0} モデル検出)
                      </p>
                    ) : (
                      <p
                        className="text-[10px] mt-2 text-amber-500 flex items-center gap-1"
                        title={probe?.reason ?? '応答なし'}
                      >
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {refreshing && autoRetryCount > 0
                            ? `再チェック中… (${autoRetryCount}/${MAX_AUTO_RETRIES})`
                            : (probe?.reason ?? '応答なし')}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" />
          CLI が応答するかのみを確認しています（API
          キーはチェック対象外。5分キャッシュ）
        </p>
      </div>
    </div>
  );
}
