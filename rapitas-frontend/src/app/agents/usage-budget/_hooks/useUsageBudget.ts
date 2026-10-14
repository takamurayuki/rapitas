'use client';
/**
 * useUsageBudget
 *
 * Loads the daily × theme usage, the monthly budget status, classification
 * rules and the theme list for the usage-budget page, and saves the budget /
 * shares / rules (re-fetching everything after a successful save).
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type {
  PendingPrompt,
  UsageBudgetUnit,
} from '@/components/providers/UsageBudgetPromptDialog';

export type { UsageBudgetUnit } from '@/components/providers/UsageBudgetPromptDialog';

export interface UsageCell {
  tokens: number;
  executions: number;
  durationMs: number;
  /** Sum over executions whose actual cost was recorded (> 0). */
  costUsd: number;
  costKnownCount: number;
  executionCount: number;
}

export interface ThemeUsageTotal extends UsageCell {
  themeId: number;
  themeName: string | null;
}

export interface ThemeUsageData {
  days: number;
  usdJpyRate: number;
  unresolvedCount: number;
  themes: ThemeUsageTotal[];
  daily: Array<{ date: string; byTheme: Record<string, UsageCell>; total: UsageCell }>;
}

export interface ThemeShare {
  themeId: number;
  sharePercent: number;
}

export interface ClassificationRule {
  id?: number;
  themeId: number;
  keyword: string;
  sortOrder: number;
  enabled: boolean;
}

export interface SuggestedShare extends ThemeShare {
  themeName: string | null;
}

export interface BudgetProjection {
  used: number;
  limit: number;
  remaining: number;
  ratio: number;
  level: 'none' | 'warn80' | 'warn90' | 'exceeded';
  avg7: number;
  daysToExhaust: number | null;
  projectedMonthEnd: number | null;
  daysLeftInMonth: number;
}

export interface ThemeBudgetUsage {
  themeId: number;
  themeName: string | null;
  used: number;
  sharePercent: number | null;
  allocated: number | null;
}

export type UsageBudgetStatus =
  | { configured: false; suggestedShares: SuggestedShare[]; suggestionReason: string | null }
  | {
      configured: true;
      unit: UsageBudgetUnit;
      monthlyLimit: number;
      month: string;
      projection: BudgetProjection;
      shares: ThemeShare[];
      themes: ThemeBudgetUsage[];
      suggestedShares: SuggestedShare[];
      suggestionReason: string | null;
      snoozedUntil: string | null;
      pendingPrompt: PendingPrompt | null;
    };

export interface ThemeOption {
  id: number;
  name: string;
}

/** Body of PUT /agent-metrics/usage-budget. */
export interface BudgetSaveBody {
  unit: UsageBudgetUnit;
  monthlyLimit: number;
  shares: ThemeShare[];
}

const BASE = `${API_BASE_URL}/agent-metrics`;

function tzOffset(): number {
  return -new Date().getTimezoneOffset();
}

async function getData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { success?: boolean; data?: T };
  if (!json.success || json.data === undefined) throw new Error('envelope failure');
  return json.data;
}

async function send(url: string, method: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Data and save actions for the usage-budget page.
 *
 * @returns State, the period setter, save actions and a reload trigger
 */
export function useUsageBudget() {
  const [days, setDays] = useState(14);
  const [usage, setUsage] = useState<ThemeUsageData | null>(null);
  const [status, setStatus] = useState<UsageBudgetStatus | null>(null);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tz = tzOffset();
    Promise.all([
      getData<ThemeUsageData>(`${BASE}/theme-usage?days=${days}&tzOffsetMinutes=${tz}`),
      getData<UsageBudgetStatus>(`${BASE}/usage-budget/status?tzOffsetMinutes=${tz}`),
      getData<ClassificationRule[]>(`${BASE}/usage-budget/rules`),
      fetch(`${API_BASE_URL}/themes`).then(async (r) =>
        r.ok ? ((await r.json()) as ThemeOption[]) : [],
      ),
    ])
      .then(([u, s, r, th]) => {
        if (cancelled) return;
        setUsage(u);
        setStatus(s);
        setRules(r);
        setThemes(th.map((x) => ({ id: x.id, name: x.name })));
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const saveBudget = useCallback(
    async (body: BudgetSaveBody) => {
      const ok = await send(`${BASE}/usage-budget?tzOffsetMinutes=${tzOffset()}`, 'PUT', body);
      if (ok) reload();
      return ok;
    },
    [reload],
  );

  const saveRules = useCallback(
    async (next: ClassificationRule[]) => {
      const ok = await send(`${BASE}/usage-budget/rules`, 'PUT', { rules: next });
      if (ok) reload();
      return ok;
    },
    [reload],
  );

  return {
    days,
    setDays,
    usage,
    status,
    rules,
    themes,
    loading,
    error,
    saveBudget,
    saveRules,
    reload,
  };
}
