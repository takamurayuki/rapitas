/**
 * Bounce Breakdown
 *
 * Pure aggregation of classified bounces: counts per kind, the tasks bounced
 * most, and repeated verify-contradiction sentence patterns. Deliberately does
 * not import loop-metrics.ts so tests that mock that module are unaffected.
 */
import {
  BOUNCE_KINDS,
  bouncePatternId,
  classifyBounceReason,
  extractContradictionSentences,
  type BounceKind,
} from './bounce-reason-classifier';

/** Maximum tasks listed in topBounceTasks. */
export const TOP_TASKS = 5;

/** One classified bounce. */
export interface BounceItem {
  kind: BounceKind;
  taskId: number | null;
  /** Combined metadata text used for classification and pattern extraction. */
  reason: string;
}

/** Per-window breakdown fields. */
export interface BounceBreakdown {
  bounceKinds: Record<BounceKind, number>;
  topBounceTasks: Array<{ taskId: number; count: number }>;
  contradictionPatterns: Array<{ patternId: string; count: number; sample: string }>;
}

function flatten(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Turn a verify_repair / ci_repair transition's metadata into a bounce item.
 *
 * @param metadata - Raw metadata JSON (may be null or malformed). / metadata文字列
 * @param taskId - Task the transition belongs to. / タスクID
 * @returns Classified bounce; malformed metadata becomes `other`. / 分類済み差し戻し
 */
export function toBounceItem(metadata: string | null, taskId?: number | null): BounceItem {
  let m: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(metadata ?? '{}');
    if (parsed && typeof parsed === 'object') m = parsed as Record<string, unknown>;
  } catch {
    // Malformed metadata → counted as `other`.
  }
  const reason = flatten(m.reason);
  const detail = [m.verifyContent, m.findings, m.failedChecks].map(flatten).join('\n');
  const kind = classifyBounceReason({ reason, detail });
  // Pattern text is the adopted affirmative sentences only, so negations never shape a pattern.
  const text =
    kind === 'verify_contradiction'
      ? extractContradictionSentences(reason, detail).join('\n')
      : [reason, detail].filter(Boolean).join('\n').trim();
  return { kind, taskId: taskId ?? null, reason: text };
}

/**
 * Aggregate bounce items.
 *
 * @param items - Classified bounces of one window. / 1窓分の差し戻し
 * @returns Kind counts (all kinds present), top tasks, contradiction patterns. / 集計結果
 */
export function summarizeBounces(items: BounceItem[]): BounceBreakdown {
  const bounceKinds = Object.fromEntries(BOUNCE_KINDS.map((k) => [k, 0])) as Record<
    BounceKind,
    number
  >;
  const perTask = new Map<number, number>();
  const patterns = new Map<string, { count: number; sample: string }>();
  for (const it of items) {
    bounceKinds[it.kind]++;
    if (it.taskId != null) perTask.set(it.taskId, (perTask.get(it.taskId) ?? 0) + 1);
    if (it.kind === 'verify_contradiction' && it.reason) {
      const id = bouncePatternId(it.reason);
      const cur = patterns.get(id);
      if (cur) cur.count++;
      else patterns.set(id, { count: 1, sample: it.reason.slice(0, 200) });
    }
  }
  const topBounceTasks = [...perTask]
    .map(([taskId, count]) => ({ taskId, count }))
    .sort((a, b) => b.count - a.count || a.taskId - b.taskId)
    .slice(0, TOP_TASKS);
  const contradictionPatterns = [...patterns]
    .map(([patternId, v]) => ({ patternId, ...v }))
    .sort((a, b) => b.count - a.count || a.patternId.localeCompare(b.patternId));
  return { bounceKinds, topBounceTasks, contradictionPatterns };
}

const KIND_LABEL: Record<BounceKind, string> = {
  verify_contradiction: '検証レポートを矛盾と判定',
  diff_review: '差分レビュー不合格',
  environment: '環境・基盤の問題',
  plan_gap: '計画・記録の不足',
  implementation_gap: '実装の不足',
  other: 'その他',
};

/**
 * Render the breakdown for a concern body.
 *
 * @param b - Window breakdown (may be absent on old data). / 内訳
 * @returns Japanese text, or '' when absent. / 本文用テキスト
 */
export function formatBounceBreakdown(b: Partial<BounceBreakdown> | undefined): string {
  const kindsMap = b?.bounceKinds;
  if (!kindsMap) return '';
  const kinds = BOUNCE_KINDS.map((k) => `${KIND_LABEL[k]} ${kindsMap[k] ?? 0} 件`).join(' / ');
  const tasks = (b.topBounceTasks ?? []).map((t) => `#${t.taskId}(${t.count}回)`).join('、');
  return `差し戻しの種類別: ${kinds}\n差し戻しの多いタスク上位: ${tasks || 'なし'}`;
}
