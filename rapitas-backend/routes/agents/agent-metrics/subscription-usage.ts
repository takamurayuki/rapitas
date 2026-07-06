/**
 * Subscription Usage
 *
 * Splits recorded Claude usage into "covered by the subscription window" vs
 * "overage" (counted separately), and reports how much of the CURRENT rolling
 * window remains. Computed locally from recorded executions (ccusage-style
 * 5-hour session blocks) — no provider scraping. Limits are estimates the
 * user tunes via env; costs stay in USD and are converted to yen at display.
 */

/** Subscription window config resolved from env. */
export interface SubscriptionConfig {
  enabled: boolean;
  /** Rolling window length in hours (Claude subscription: 5h sessions). */
  windowHours: number;
  /** Estimated API-equivalent USD budget per window (plan-dependent). */
  windowLimitUsd: number;
}

/** Current-window state + period covered/overage split. */
export interface SubscriptionUsage {
  windowHours: number;
  windowLimitUsd: number;
  currentWindow: {
    /** ISO start/end of the active window; null when no window is active. */
    startedAt: string | null;
    endsAt: string | null;
    usedUsd: number;
    remainingUsd: number;
    /** used / limit, 0..1+ (can exceed 1 when over the limit). */
    usedRatio: number;
  };
  period: {
    /** Usage that fit within window limits (included in the subscription). */
    coveredUsd: number;
    /** Usage beyond a window's limit — billed/tracked separately. */
    overageUsd: number;
  };
}

/**
 * Resolve subscription config from env.
 *
 * RAPITAS_SUB_LIMIT_ENABLED=0 hides the feature; RAPITAS_SUB_WINDOW_HOURS and
 * RAPITAS_SUB_WINDOW_LIMIT_USD tune the window. The default limit ($35 per 5h
 * window) is a rough Max-plan estimate — treat it as a gauge, not billing.
 *
 * @returns Effective subscription config / 有効なサブスク設定
 */
export function getSubscriptionConfig(): SubscriptionConfig {
  const hours = parseFloat(process.env.RAPITAS_SUB_WINDOW_HOURS ?? '');
  const limit = parseFloat(process.env.RAPITAS_SUB_WINDOW_LIMIT_USD ?? '');
  return {
    enabled: process.env.RAPITAS_SUB_LIMIT_ENABLED !== '0',
    windowHours: Number.isFinite(hours) && hours > 0 ? hours : 5,
    windowLimitUsd: Number.isFinite(limit) && limit > 0 ? limit : 35,
  };
}

/** One execution's timestamp + recorded cost, pre-filtered to the subscribed agent. */
export interface SubscriptionExec {
  at: Date;
  costUsd: number;
}

function floorToHour(ms: number): number {
  return ms - (ms % 3_600_000);
}

/**
 * Partition executions into rolling windows and compute covered/overage plus
 * the current window's remaining budget. Pure — testable without a DB.
 *
 * Window rule (ccusage-style session blocks): a window opens at the first
 * activity (floored to the hour) after the previous window closed, and lasts
 * `windowHours`. Usage beyond `windowLimitUsd` within one window is overage.
 *
 * @param execs - Executions (any order) for the subscribed agent / 対象実行
 * @param cfg - Window config / 枠設定
 * @param now - Current time (injectable for tests) / 現在時刻
 * @returns Subscription usage summary / サブスク使用量サマリ
 */
export function computeSubscriptionUsage(
  execs: SubscriptionExec[],
  cfg: Pick<SubscriptionConfig, 'windowHours' | 'windowLimitUsd'>,
  now: Date = new Date(),
): SubscriptionUsage {
  const windowMs = cfg.windowHours * 3_600_000;
  const sorted = [...execs].sort((a, b) => a.at.getTime() - b.at.getTime());

  interface Block {
    start: number;
    end: number;
    usedUsd: number;
  }
  const blocks: Block[] = [];
  for (const e of sorted) {
    const t = e.at.getTime();
    const last = blocks[blocks.length - 1];
    if (!last || t >= last.end) {
      blocks.push({ start: floorToHour(t), end: floorToHour(t) + windowMs, usedUsd: e.costUsd });
    } else {
      last.usedUsd += e.costUsd;
    }
  }

  let coveredUsd = 0;
  let overageUsd = 0;
  for (const b of blocks) {
    coveredUsd += Math.min(b.usedUsd, cfg.windowLimitUsd);
    overageUsd += Math.max(0, b.usedUsd - cfg.windowLimitUsd);
  }

  const last = blocks[blocks.length - 1];
  const active = last && now.getTime() < last.end ? last : null;
  const usedUsd = active ? active.usedUsd : 0;

  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    windowHours: cfg.windowHours,
    windowLimitUsd: cfg.windowLimitUsd,
    currentWindow: {
      startedAt: active ? new Date(active.start).toISOString() : null,
      endsAt: active ? new Date(active.end).toISOString() : null,
      usedUsd: round2(usedUsd),
      remainingUsd: round2(Math.max(0, cfg.windowLimitUsd - usedUsd)),
      usedRatio:
        cfg.windowLimitUsd > 0 ? Math.round((usedUsd / cfg.windowLimitUsd) * 1000) / 1000 : 0,
    },
    period: { coveredUsd: round2(coveredUsd), overageUsd: round2(overageUsd) },
  };
}
