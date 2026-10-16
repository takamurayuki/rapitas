/**
 * daily-report-core
 *
 * Types and the PURE aggregation core of the autonomous-activity daily report:
 * turns pre-fetched raw rows (last 24h) into the structured report data.
 * No prisma, no filesystem, no clock reads beyond the `now` argument — the
 * DB/FS access lives in daily-report-service, formatting in
 * daily-report-format.
 */
import { parseDecider, type DecisionActor } from '../memory/decision-journal';

/** Aggregation window: the "last 24 hours" required by task #564. */
export const DAILY_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Raw input shape (rows fetched by the thin collect layer)
// ---------------------------------------------------------------------------

/** Completed task row with its linked PR number already resolved. */
export interface RawCompletedTask {
  id: number;
  title: string;
  completedAt: Date | null;
  prNumber: number | null;
}

/** Merged-PR row (window matched on updatedAt — see NOTE in the collect layer). */
export interface RawMergedPr {
  prNumber: number;
  title: string;
  url: string;
}

/** Concern KnowledgeEntry row; `tags` is the raw JSON string column. */
export interface RawConcern {
  id: number;
  title: string;
  tags: string;
}

/** DecisionLog row; actor is recovered from `context` via parseDecider. */
export interface RawDecision {
  id: number;
  decision: string;
  rationale: string | null;
  context: string | null;
  predictedOutcome: string;
  confidence: number;
}

/** Self-restart counts from the two disjoint recording paths. */
export interface RawRestartCounts {
  fromCycleLog: number;
  fromNotifications: number;
}

/** ThemeAutoRun row used for the satiation (armed-idle) judgement. */
export interface RawThemeAutoRun {
  themeId: number;
  enabled: boolean;
  status: string;
}

/** Pending top-level task eligible for the upcoming-queue preview. */
export interface RawQueueTask {
  id: number;
  title: string;
  priority: string | null;
  createdAt: Date;
}

/** Everything the pure aggregation core needs, pre-fetched. */
export interface DailyReportRaw {
  tasks: RawCompletedTask[];
  prs: RawMergedPr[];
  concerns: RawConcern[];
  decisions: RawDecision[];
  restarts: RawRestartCounts;
  themes: RawThemeAutoRun[];
  queueCandidates: RawQueueTask[];
}

// ---------------------------------------------------------------------------
// Aggregated output shape
// ---------------------------------------------------------------------------

/** One decision entry in the report. */
export interface ReportDecision {
  id: number;
  decision: string;
  rationale: string | null;
  actor: DecisionActor;
  confidence: number;
}

/** Fully aggregated data for one report day. */
export interface DailyReportData {
  /** Local YYYY-MM-DD of the report day (= the morning it is delivered). */
  date: string;
  windowStart: string;
  windowEnd: string;
  completedTasks: Array<{ id: number; title: string; prNumber: number | null }>;
  /** `approximate` — no mergedAt column; window matched on updatedAt. */
  mergedPrs: { approximate: true; items: RawMergedPr[] };
  concerns: { total: number; bySource: Record<string, number> };
  learnings: { retro: string[]; incident: string[] };
  decisions: ReportDecision[];
  restartCount: number;
  restartBreakdown: RawRestartCounts;
  humanIntervention: { occurred: boolean; count: number };
  /** Preview only — approximate rank, NOT the selection engine's exact order. */
  upcomingQueue: Array<{ id: number; title: string; priority: string }>;
  satiated: boolean;
  satiatedReason: string | null;
  /** True when every aggregated source is zero (skip the AI call). */
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Pure aggregation core
// ---------------------------------------------------------------------------

/**
 * Local YYYY-MM-DD stamp (same format as cycle-event-logger's daily files).
 *
 * @param d - Date to stamp / 対象日時
 * @returns Local date stamp / ローカル日付
 */
export function localDateStamp(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Extracts the `source:<label>` tag from a concern's tags JSON, or 'unknown'. */
function parseConcernSource(tags: string): string {
  try {
    const arr: unknown = JSON.parse(tags);
    if (Array.isArray(arr)) {
      for (const t of arr) {
        if (typeof t === 'string' && t.startsWith('source:')) {
          return t.slice('source:'.length) || 'unknown';
        }
      }
    }
  } catch {
    // Malformed tags — bucket as unknown rather than fail the report.
  }
  return 'unknown';
}

// Mirrors auto-run-selection's priority order for the queue PREVIEW only,
// implemented locally (plan decision) so the report never touches the
// selection engine. The valueBand tie-break is intentionally omitted: without
// a per-theme success rate valueBandScore() degenerates to a constant, so
// priority → createdAt yields the identical ordering.
const QUEUE_PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function queuePriorityRank(priority: string | null): number {
  if (!priority) return QUEUE_PRIORITY_RANK.medium;
  const r = QUEUE_PRIORITY_RANK[priority.toLowerCase()];
  return r === undefined ? QUEUE_PRIORITY_RANK.medium : r;
}

/**
 * Aggregate raw 24h activity rows into the report data. Pure — no prisma, no
 * filesystem, no clock reads beyond the `now` argument.
 *
 * @param raw - Pre-fetched rows for the window / 取得済みの生データ
 * @param now - Report generation time (window end) / レポート生成時刻
 * @returns Aggregated report data / 集計済みレポートデータ
 */
export function buildDailyReportData(raw: DailyReportRaw, now: Date): DailyReportData {
  const windowStart = new Date(now.getTime() - DAILY_REPORT_WINDOW_MS);

  const completedTasks = raw.tasks.map((t) => ({ id: t.id, title: t.title, prNumber: t.prNumber }));

  const bySource: Record<string, number> = {};
  const retro: string[] = [];
  const incident: string[] = [];
  for (const c of raw.concerns) {
    const source = parseConcernSource(c.tags);
    bySource[source] = (bySource[source] ?? 0) + 1;
    // Retro/incident learnings are the concern subsets filed by those jobs.
    if (source === 'process_retro') retro.push(c.title);
    if (source === 'self_incident_watch') incident.push(c.title);
  }

  const decisions: ReportDecision[] = raw.decisions.map((d) => ({
    id: d.id,
    decision: d.decision,
    rationale: d.rationale,
    actor: parseDecider(d.context),
    confidence: d.confidence,
  }));
  const interventionCount = decisions.filter((d) => d.actor === 'user').length;
  const restartCount = raw.restarts.fromCycleLog + raw.restarts.fromNotifications;

  const upcomingQueue = [...raw.queueCandidates]
    .sort((a, b) => {
      const pr = queuePriorityRank(a.priority) - queuePriorityRank(b.priority);
      return pr !== 0 ? pr : a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, 3)
    .map((t) => ({ id: t.id, title: t.title, priority: t.priority ?? 'medium' }));

  const armedIdleThemes = raw.themes.filter((t) => t.enabled && t.status === 'idle');
  const satiated = completedTasks.length === 0 && armedIdleThemes.length > 0;
  const satiatedReason = satiated
    ? `有効なテーマ ${armedIdleThemes.length} 件が armed-idle（実行可能なバックログが尽きた飽和状態）で待機しており、` +
      '直近24時間は完了タスク0件のまま静止していました。新しいバックログが起票され次第、自動で再開されます。'
    : null;

  const empty =
    completedTasks.length === 0 &&
    raw.prs.length === 0 &&
    raw.concerns.length === 0 &&
    decisions.length === 0 &&
    restartCount === 0;

  return {
    date: localDateStamp(now),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    completedTasks,
    mergedPrs: { approximate: true, items: raw.prs },
    concerns: { total: raw.concerns.length, bySource },
    learnings: { retro, incident },
    decisions,
    restartCount,
    restartBreakdown: raw.restarts,
    humanIntervention: { occurred: interventionCount > 0, count: interventionCount },
    upcomingQueue,
    satiated,
    satiatedReason,
    empty,
  };
}
