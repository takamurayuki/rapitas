/**
 * usage-budget-service
 *
 * Status, threshold evaluation (one notification per month and level, CAS
 * guarded), budget/share updates, prompt responses and classification-rule
 * CRUD. Advisory only: nothing here blocks, defers or throttles an execution.
 */
import { createLogger } from '../../config/logger';
import {
  computeAvg7,
  computeProjection,
  levelKey,
  localDayStart,
  monthKey,
  monthWindow,
  sampleUsage,
  shouldPrompt,
  suggestShares,
  validateMonthlyLimit,
  validateShares,
} from './usage-budget-math';
import {
  DEFER_DURATION_MS,
  PROMPT_ACTIONS,
  USAGE_BUDGET_UNITS,
  type ClassificationRule,
  type ExecutionUsageSample,
  type PendingPrompt,
  type PromptAction,
  type ThemeBudgetUsage,
  type ThemeShare,
  type UsageBudgetStatus,
  type UsageBudgetUnit,
} from './usage-budget-types';
import type { UsageBudgetStore } from './usage-budget-store';

const log = createLogger('usage-budget');
const SUGGESTION_DAYS = 30;
const MAX_KEYWORD_LENGTH = 100;

/** Rejected input — routes map this to HTTP 400. */
export class UsageBudgetValidationError extends Error {}

/** Collaborators, injected so tests run without a database. */
export interface UsageBudgetDeps {
  store: UsageBudgetStore;
  loadSamples(
    since: Date,
    rules: ClassificationRule[],
    now: Date,
  ): Promise<{ samples: ExecutionUsageSample[]; unresolvedCount: number }>;
  loadThemeNames(themeIds: number[]): Promise<Map<number, string>>;
  notify(prompt: PendingPrompt): Promise<void>;
  now(): Date;
}

/** Status of POST /evaluate: the regular status plus whether this call notified. */
export type EvaluateResult = UsageBudgetStatus & { notified: boolean };

/**
 * Build the usage-budget service over the given collaborators.
 *
 * @param deps - Store, sample loader, name lookup, notifier, clock / 依存関係
 * @returns Service operations / サービス操作
 */
export function createUsageBudgetService(deps: UsageBudgetDeps) {
  async function getStatus(tzOffsetMinutes: number): Promise<UsageBudgetStatus> {
    const now = deps.now();
    const [cfg, rules, shares] = await Promise.all([
      deps.store.getConfig(),
      deps.store.getRules(),
      deps.store.getShares(),
    ]);
    const unit: UsageBudgetUnit = cfg?.unit ?? 'tokens';
    const month = monthWindow(now, tzOffsetMinutes);
    const start30 = localDayStart(now, tzOffsetMinutes, SUGGESTION_DAYS - 1);
    // One load covers the month, the 7-day average (may reach into last month) and the 30-day suggestion.
    const since = new Date(Math.min(month.start.getTime(), start30.getTime()));
    const { samples } = await deps.loadSamples(since, rules, now);

    const usage30 = new Map<number, number>();
    const usageMonth = new Map<number, number>();
    let used = 0;
    for (const s of samples) {
      const v = sampleUsage(s, unit);
      if (s.at >= start30) usage30.set(s.themeId, (usage30.get(s.themeId) ?? 0) + v);
      if (s.at >= month.start) {
        usageMonth.set(s.themeId, (usageMonth.get(s.themeId) ?? 0) + v);
        used += v;
      }
    }
    const suggested = suggestShares(usage30);
    const names = await deps.loadThemeNames([
      ...suggested.map((s) => s.themeId),
      ...usageMonth.keys(),
      ...shares.map((s) => s.themeId),
    ]);
    const suggestedShares = suggested.map((s) => ({
      ...s,
      themeName: names.get(s.themeId) ?? null,
    }));
    const suggestionReason = suggested.length === 0 ? 'no_usage_in_last_30_days' : null;

    if (!cfg) return { configured: false, suggestedShares, suggestionReason };

    const projection = computeProjection({
      used,
      limit: cfg.monthlyLimit,
      avg7: computeAvg7(samples, unit, now, tzOffsetMinutes),
      daysLeftInMonth: month.daysLeftInMonth,
    });
    const shareMap = new Map(shares.map((s) => [s.themeId, s.sharePercent]));
    const themeIds = new Set<number>([...usageMonth.keys(), ...shareMap.keys()]);
    const themes: ThemeBudgetUsage[] = Array.from(themeIds)
      .map((themeId) => {
        const sharePercent = shareMap.get(themeId) ?? null;
        return {
          themeId,
          themeName: names.get(themeId) ?? null,
          used: usageMonth.get(themeId) ?? 0,
          sharePercent,
          allocated: sharePercent === null ? null : (cfg.monthlyLimit * sharePercent) / 100,
        };
      })
      .sort((a, b) => b.used - a.used || a.themeId - b.themeId);

    const monthId = monthKey(now, tzOffsetMinutes);
    const key = levelKey(monthId, projection.level);
    const pendingPrompt: PendingPrompt | null =
      projection.level !== 'none' && shouldPrompt(cfg, projection.level, key, now)
        ? {
            key,
            level: projection.level,
            unit,
            used: projection.used,
            limit: projection.limit,
            remaining: projection.remaining,
            avg7: projection.avg7,
            daysToExhaust: projection.daysToExhaust,
            projectedMonthEnd: projection.projectedMonthEnd,
          }
        : null;

    return {
      configured: true,
      unit,
      monthlyLimit: cfg.monthlyLimit,
      month: monthId,
      projection,
      shares,
      themes,
      suggestedShares,
      suggestionReason,
      snoozedUntil: cfg.snoozedUntil ? cfg.snoozedUntil.toISOString() : null,
      pendingPrompt,
    };
  }

  async function evaluate(tzOffsetMinutes: number): Promise<EvaluateResult> {
    const status = await getStatus(tzOffsetMinutes);
    // A snoozed or acknowledged level has no pendingPrompt, so it is not re-notified either.
    if (!status.configured || !status.pendingPrompt) return { ...status, notified: false };
    const prompt = status.pendingPrompt;
    const previous = (await deps.store.getConfig())?.lastNotifiedKey ?? null;
    if (previous === prompt.key) return { ...status, notified: false };
    if (!(await deps.store.claimNotification(prompt.key))) return { ...status, notified: false };
    try {
      await deps.notify(prompt);
      return { ...status, notified: true };
    } catch (err) {
      // Roll the claim back so the next evaluate retries instead of silently
      // treating an undelivered alert as sent.
      await deps.store.releaseNotification(prompt.key, previous);
      log.error({ err, key: prompt.key }, 'Failed to create usage budget notification');
      return { ...status, notified: false };
    }
  }

  /** Clear 続行/後回し when a limit change leaves usage at or above the new limit. */
  async function resetPromptIfExceeded(tzOffsetMinutes: number): Promise<void> {
    const status = await getStatus(tzOffsetMinutes);
    if (status.configured && status.projection.level === 'exceeded') {
      await deps.store.updateConfig({ acknowledgedKey: null, snoozedUntil: null });
    }
  }

  async function updateBudget(
    body: { unit?: unknown; monthlyLimit?: unknown; shares?: unknown },
    tzOffsetMinutes: number,
  ): Promise<UsageBudgetStatus> {
    if (!(USAGE_BUDGET_UNITS as readonly unknown[]).includes(body.unit)) {
      throw new UsageBudgetValidationError('unit must be tokens or executions');
    }
    const limitError = validateMonthlyLimit(body.monthlyLimit);
    if (limitError) throw new UsageBudgetValidationError(limitError);
    const shares = parseShares(body.shares);
    const before = await deps.store.getConfig();
    await deps.store.saveBudget({
      unit: body.unit as UsageBudgetUnit,
      monthlyLimit: body.monthlyLimit as number,
      shares,
    });
    if (!before || before.monthlyLimit !== body.monthlyLimit || before.unit !== body.unit) {
      await resetPromptIfExceeded(tzOffsetMinutes);
    }
    return getStatus(tzOffsetMinutes);
  }

  async function respondToPrompt(
    body: { action?: unknown; monthlyLimit?: unknown },
    tzOffsetMinutes: number,
  ): Promise<UsageBudgetStatus> {
    if (!(PROMPT_ACTIONS as readonly unknown[]).includes(body.action)) {
      throw new UsageBudgetValidationError('action must be continue, defer or change_limit');
    }
    const action = body.action as PromptAction;
    const cfg = await deps.store.getConfig();
    if (!cfg) throw new UsageBudgetValidationError('usage budget is not configured');

    if (action === 'continue') {
      const status = await getStatus(tzOffsetMinutes);
      if (status.configured && status.projection.level !== 'none') {
        await deps.store.updateConfig({
          acknowledgedKey: levelKey(status.month, status.projection.level),
        });
      }
    } else if (action === 'defer') {
      await deps.store.updateConfig({
        snoozedUntil: new Date(deps.now().getTime() + DEFER_DURATION_MS),
      });
    } else {
      const limitError = validateMonthlyLimit(body.monthlyLimit);
      if (limitError) throw new UsageBudgetValidationError(limitError);
      await deps.store.updateConfig({ monthlyLimit: body.monthlyLimit as number });
      await resetPromptIfExceeded(tzOffsetMinutes);
    }
    return getStatus(tzOffsetMinutes);
  }

  async function replaceRules(raw: unknown): Promise<ClassificationRule[]> {
    await deps.store.replaceRules(parseRules(raw));
    return deps.store.getRules();
  }

  return {
    getStatus,
    evaluate,
    updateBudget,
    respondToPrompt,
    getRules: () => deps.store.getRules(),
    replaceRules,
  };
}

/** Service instance type. */
export type UsageBudgetService = ReturnType<typeof createUsageBudgetService>;

function parseShares(raw: unknown): ThemeShare[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new UsageBudgetValidationError('shares must be an array');
  const shares = raw.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { themeId: o.themeId as number, sharePercent: o.sharePercent as number };
  });
  const err = validateShares(shares);
  if (err) throw new UsageBudgetValidationError(err);
  return shares;
}

function parseRules(raw: unknown): ClassificationRule[] {
  if (!Array.isArray(raw)) throw new UsageBudgetValidationError('rules must be an array');
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const keyword = typeof o.keyword === 'string' ? o.keyword.trim() : '';
    if (keyword.length === 0 || keyword.length > MAX_KEYWORD_LENGTH) {
      throw new UsageBudgetValidationError(
        `rules[${i}].keyword must be 1-${MAX_KEYWORD_LENGTH} chars`,
      );
    }
    if (typeof o.themeId !== 'number' || !Number.isInteger(o.themeId) || o.themeId <= 0) {
      throw new UsageBudgetValidationError(`rules[${i}].themeId must be a positive integer`);
    }
    const sortOrder = o.sortOrder === undefined ? i : o.sortOrder;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) {
      throw new UsageBudgetValidationError(`rules[${i}].sortOrder must be an integer`);
    }
    return { themeId: o.themeId, keyword, sortOrder, enabled: o.enabled !== false };
  });
}
