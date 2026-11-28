/**
 * self-verify-miss/miss-classify
 *
 * The payload contract of a "self-verify miss" (task 1602) — a real gate that
 * failed after a passing self-verify run — and the pure rules that name the
 * gate, its kind and the files. Not responsible for reading or writing events.
 */

/** TimelineEvent type of one miss. */
export const SELF_VERIFY_MISS_EVENT = 'self_verify_miss' as const;

/** mechanical: a machine check could have caught it. judgment: a reviewer's call. */
export type MissKind = 'mechanical' | 'judgment';

/** `verify` | `diff_review` | `ci:<CI job name>` | `presave:<check name>`. */
export type SelfVerifyMissGate = 'verify' | 'diff_review' | `ci:${string}` | `presave:${string}`;

/** Family of a gate, for grouping. */
export type MissGateFamily = 'verify' | 'diff_review' | 'ci' | 'presave';

/** Payload of one `self_verify_miss` event. */
export interface SelfVerifyMissPayload {
  taskId: number;
  /** runId of the passing self-verify job the gate contradicted. */
  runId: string;
  /** HEAD SHA that job started at. */
  revision: string | null;
  gate: SelfVerifyMissGate;
  gateFamily: MissGateFamily;
  /** Check (`lint`) or CI job (`Lint Code`) name; null for verify / diff_review. */
  checkName: string | null;
  kind: MissKind;
  reasonSummary: string;
  files: string[];
  /** `${runId}|${gate}` — one miss per job and gate. */
  dedupKey: string;
}

const MAX_REASON_CHARS = 500;
const MAX_FILES = 200;

/** Correlation id of one task's misses. */
export const missCorrelationId = (taskId: number) => `self-verify-miss-${taskId}`;

/**
 * Family of a gate.
 *
 * @param gate - Gate name / ゲート名
 * @returns Its family / 種別
 */
export function gateFamilyOf(gate: SelfVerifyMissGate): MissGateFamily {
  if (gate.startsWith('ci:')) return 'ci';
  if (gate.startsWith('presave:')) return 'presave';
  return gate as 'verify' | 'diff_review';
}

/**
 * Kind of a gate: the CI and pre-save checks are machines, the verifier and
 * the diff review are judgment.
 *
 * @param gate - Gate name / ゲート名
 * @returns mechanical or judgment / 種類
 */
export function kindOfGate(gate: SelfVerifyMissGate): MissKind {
  const family = gateFamilyOf(gate);
  return family === 'ci' || family === 'presave' ? 'mechanical' : 'judgment';
}

/**
 * First 500 characters of a rejection reason, trimmed.
 *
 * @param reason - Full reason / 理由
 * @returns Summary / 要約
 */
export function summarizeReason(reason: string): string {
  return reason.trim().slice(0, MAX_REASON_CHARS);
}

/** One gate a rejection is filed under. */
export interface ClassifiedMiss {
  gate: SelfVerifyMissGate;
  checkName: string | null;
}

const NG_RE = /\b([a-z][a-z-]*)=NG\(\d+\)/g;
/** Advisory checks the overall verdict ignores; never the cause of a rejection. */
const ADVISORY = new Set(['scope', 'acceptance', 'attribution']);

/**
 * Name the gate(s) behind a verify→implement rejection. Empty when the
 * rejection is not something a self-verify run could have caught.
 *
 * @param reason - Rejection reason passed to attemptVerifyRepair / 差し戻し理由
 * @param grounds - Findings and the caller's miss hint / 指摘と呼び出し元の指定
 * @returns Gates to file / 記録するゲート
 */
export function classifyRepairMiss(
  reason: string,
  grounds?: { findings?: unknown[]; missGate?: 'none' },
): ClassifiedMiss[] {
  if (grounds?.missGate === 'none' || /mergeStateStatus=DIRTY/.test(reason)) return [];
  if (reason.includes('差分レビュー') || (grounds?.findings?.length ?? 0) > 0) {
    return [{ gate: 'diff_review', checkName: null }];
  }
  // The post-commit gate's reason carries the verifier's `name=NG(n)` summary:
  // a machine check failed at the save stage, so it is filed as presave.
  if (reason.includes('自動検証')) {
    const names = [...new Set([...reason.matchAll(NG_RE)].map((m) => m[1]!))].filter(
      (n) => !ADVISORY.has(n),
    );
    if (names.length > 0) {
      return names.map((n) => ({ gate: `presave:${n}` as const, checkName: n }));
    }
  }
  return [{ gate: 'verify', checkName: null }];
}

/** Text of a finding the juror wrote (summary / evidence / file). */
function findingText(f: unknown): string {
  if (!f || typeof f !== 'object') return '';
  const o = f as Record<string, unknown>;
  return ['file', 'evidence', 'summary']
    .map((k) => (typeof o[k] === 'string' ? (o[k] as string) : ''))
    .join(' ');
}

/**
 * Files of a miss: those the gate named, else the changed files of the
 * passing job (a miss must always point somewhere).
 *
 * @param reason - Rejection reason / 差し戻し理由
 * @param findings - Juror findings / 指摘
 * @param changed - Changed files of the passing job / 合格ジョブの変更ファイル
 * @param explicit - Files the gate reported itself / ゲートが示したファイル
 * @returns Repo-relative files, at most 200 / ファイル
 */
export function filesForMiss(
  reason: string,
  findings: unknown[],
  changed: string[],
  explicit: string[] = [],
): string[] {
  const text = [reason, ...findings.map(findingText)].join('\n').replace(/\\/g, '/');
  const tokens = [...text.matchAll(/[\w.@/-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]);
  const named = changed.filter((f) =>
    tokens.some((t) => t === f || f.endsWith(`/${t}`) || t.endsWith(`/${f}`)),
  );
  const out = [...new Set([...explicit, ...named])];
  return (out.length > 0 ? out : changed).slice(0, MAX_FILES);
}
