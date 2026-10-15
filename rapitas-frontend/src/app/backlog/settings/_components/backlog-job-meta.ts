/**
 * backlog-job-meta
 *
 * Maps a backlog periodic-job kind to its icon and colour, and answers safely
 * for a kind this build does not know about.
 * Not responsible for the job's label/description text — that lives in i18n
 * (backlog.settings.jobs.<kind>.*).
 */

import {
  Sparkles,
  Bug,
  Activity,
  IterationCw,
  MonitorCheck,
  Sunrise,
  ScanSearch,
  ShieldHalf,
} from 'lucide-react';

/** Job kinds this build has an icon and i18n text for. */
export type JobKind =
  | 'innovation'
  | 'vuln_scan'
  | 'health_check'
  | 'loop_review'
  | 'ci_watch'
  | 'daily_report'
  | 'miss_ledger'
  | 'pr_risk_review';

/** Icon + colour per known kind. */
export interface JobMeta {
  icon: typeof Sparkles;
  color: string;
}

// NOTE: `label`/`desc` text moved to i18n (backlog.settings.jobs.<kind>.*);
// look it up with `t(`jobs.${kind}.label`)` at each render site.
export const JOB_META: Record<JobKind, JobMeta> = {
  innovation: { icon: Sparkles, color: 'text-amber-500' },
  vuln_scan: { icon: Bug, color: 'text-rose-500' },
  health_check: { icon: Activity, color: 'text-sky-500' },
  loop_review: { icon: IterationCw, color: 'text-emerald-500' },
  ci_watch: { icon: MonitorCheck, color: 'text-violet-500' },
  // NOTE: Sunrise = 自律活動デイリーレポート (ICON_POLICY §3).
  daily_report: { icon: Sunrise, color: 'text-amber-500' },
  // NOTE: ScanSearch = 検出漏れ兆候の学習・レビュー (ICON_POLICY §3).
  miss_ledger: { icon: ScanSearch, color: 'text-indigo-500' },
  // NOTE: ShieldHalf = PR リスク予測 (ICON_POLICY §3, glyphs-n-s.md).
  pr_risk_review: { icon: ShieldHalf, color: 'text-orange-500' },
};

/**
 * Icon and colour for a job kind, or null when this build has none.
 *
 * NOTE: The backend owns the list of kinds and seeds a schedule row for every
 * one of them, so /backlog/schedules can legitimately return a kind that
 * shipped after this bundle. Measured 2026-10-11 against the live API: it
 * returned 11 kinds while this map had 8, and the render site did
 * `JOB_META[s.kind].icon` with no guard — so `gate_precision`,
 * `knowledge_reuse` and `outage_simulation` each threw a TypeError and took the
 * whole settings page down. Returning null lets the row render without an icon,
 * which keeps the job visible and toggleable instead of crashing the page.
 *
 * @param kind - Kind string straight from the API / API が返した kind 文字列
 * @returns The icon/colour pair, or null for an unknown kind / 不明な kind は null
 */
export function resolveJobMeta(kind: string): JobMeta | null {
  return Object.prototype.hasOwnProperty.call(JOB_META, kind) ? JOB_META[kind as JobKind] : null;
}
