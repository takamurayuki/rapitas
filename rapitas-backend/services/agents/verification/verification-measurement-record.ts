/**
 * verification-measurement-record
 *
 * Persists the raw automated-verifier result measured for a task's verifier
 * (timeline `verification_measured`) and reads it back for the adversarial
 * jury, plus extracts verify.md's one-line overall claim. Not responsible for
 * running the verifier or for any verdict.
 *
 * Why a separate record: the measurement used to exist only inside the
 * verifier's prompt. The jury must see the MEASURED data without the
 * verifier's own prose (independence), so the server keeps the structured
 * result itself and the jury renders it from that, never from verify.md.
 */
import { appendEvent, queryEvents } from '../../memory/timeline';
import { renderVerificationMarkdown } from './verification-report';
import type { VerificationResult } from './automated-verifier';

/** Cap on the measured block placed into the jury prompt. */
const MAX_MEASURED_CHARS = 6000;

/**
 * What a measurement was taken on. A measurement is evidence only about this
 * exact worktree + diff; `executionId` is kept for audit (the run whose output
 * was measured) but is not part of the match — the verifier's own run comes
 * after the measurement by design.
 */
export interface MeasurementTarget {
  worktreePath: string;
  /** review-diff-fingerprint of the measured diff; null when unknown. */
  diffFingerprint: string | null;
  executionId?: number | null;
}

/** Measurement as stored on the timeline payload. */
export interface RecordedMeasurement {
  taskId: number;
  measuredAt: string;
  result: VerificationResult;
  /** Absent on measurements recorded before targets were stored. */
  target?: MeasurementTarget;
}

/** How many recent measurements to scan for one matching the current target. */
const MEASUREMENT_SCAN_LIMIT = 20;

/**
 * Store one measured verification result for a task. Never throws.
 *
 * @param taskId - Task measured / 対象タスク
 * @param result - Raw automated-verifier result / 自動検証の生の結果
 * @param target - Worktree / diff / execution measured / 計測対象
 */
export async function recordVerificationMeasurement(
  taskId: number,
  result: VerificationResult,
  target: MeasurementTarget,
): Promise<void> {
  await appendEvent({
    eventType: 'verification_measured',
    actorType: 'system',
    payload: {
      taskId,
      measuredAt: new Date().toISOString(),
      target: {
        worktreePath: target.worktreePath,
        diffFingerprint: target.diffFingerprint,
        executionId: target.executionId ?? null,
      },
      result: {
        ok: result.ok,
        verdict: result.verdict,
        summary: result.summary,
        unverifiable: result.unverifiable,
        changedFiles: result.changedFiles.slice(0, 200),
        checks: result.checks,
      },
    },
    correlationId: `task-${taskId}`,
  }).catch(() => {});
}

function toRecorded(
  taskId: number,
  event: { payload: unknown; createdAt: Date },
): RecordedMeasurement | null {
  const payload = event.payload as Partial<RecordedMeasurement> | undefined;
  if (!payload?.result || !Array.isArray(payload.result.checks)) return null;
  return {
    taskId,
    measuredAt: String(payload.measuredAt ?? event.createdAt),
    result: { ...payload.result, changedFiles: payload.result.changedFiles ?? [] },
    target: payload.target,
  };
}

/**
 * Whether a stored measurement was taken on the given worktree and diff.
 * Unknown on either side (legacy record, unreadable diff) is NOT a match.
 *
 * @param m - Stored measurement / 保存済みの実測
 * @param target - What is being reviewed now / 現在の審査対象
 * @returns True when it measured exactly this target / 同じ対象なら true
 */
export function measurementMatchesTarget(
  m: RecordedMeasurement,
  target: { worktreePath: string; diffFingerprint: string | null },
): boolean {
  const t = m.target;
  if (!t || !t.diffFingerprint || !target.diffFingerprint) return false;
  return t.worktreePath === target.worktreePath && t.diffFingerprint === target.diffFingerprint;
}

/**
 * The newest measurement taken on the current worktree + diff. A newer or
 * older measurement of something else is history: it is not returned as
 * `current`, only flagged through `stale` (so the jury is never handed an
 * old failure as evidence against a changed diff). Never throws.
 *
 * @param taskId - Task id / タスクID
 * @param target - Worktree and diff being reviewed / 審査対象の worktree と差分
 * @returns `current` match (or null) and whether a non-matching newest one exists / 一致する実測と、不一致の有無
 */
export async function loadMeasurementForTarget(
  taskId: number,
  target: { worktreePath: string; diffFingerprint: string | null },
): Promise<{ current: RecordedMeasurement | null; stale: boolean }> {
  try {
    const { events } = await queryEvents({
      eventType: 'verification_measured',
      correlationId: `task-${taskId}`,
      limit: MEASUREMENT_SCAN_LIMIT,
    });
    const recorded = events
      .map((e) => toRecorded(taskId, e))
      .filter((m): m is RecordedMeasurement => m !== null);
    const current = recorded.find((m) => measurementMatchesTarget(m, target)) ?? null;
    const newest = recorded[0];
    return { current, stale: !!newest && newest !== current };
  } catch {
    return { current: null, stale: false };
  }
}

/**
 * Render a stored measurement for the jury prompt (server renderer, bounded).
 *
 * @param m - Stored measurement / 保存済みの実測
 * @returns Prompt block / プロンプト用テキスト
 */
export function renderMeasurementForJury(m: RecordedMeasurement): string {
  const body = `計測時刻: ${m.measuredAt}\n\n${renderVerificationMarkdown(m.result)}`;
  return body.length > MAX_MEASURED_CHARS
    ? `${body.slice(0, MAX_MEASURED_CHARS)}\n…[省略: 実測データが長いため以降を省略]`
    : body;
}

const CLAIM_KEY_RE = /総合判定|総合評価|overall\s+verdict/i;

/** The only verdict labels passed to the jury. Fail is tested first: 不合格 contains 合格. */
const CLAIM_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:❌|✗|×|不合格|失敗|検証失敗|fail(?:ed)?\b|ng\b)/i, '❌ 不合格'],
  [/^(?:⚠️?|条件付き|一部合格|partial(?:ly)?\b|conditional\b)/i, '⚠️ 条件付き'],
  [/^(?:✅|✔️?|合格|成功|検証成功|pass(?:ed)?\b|ok\b)/i, '✅ 合格'],
];

function labelOf(value: string): string | null {
  const v = value.replace(/^[\s*_`"'「【\[(（]+/, '');
  for (const [re, label] of CLAIM_LABELS) if (re.test(v)) return label;
  return null;
}

/**
 * verify.md's overall verdict as a fixed LABEL only (✅ 合格 / ❌ 不合格 /
 * ⚠️ 条件付き). The verifier's prose never passes: a value that does not
 * start with a recognised label yields null, which the prompt renders as
 * 記載なし.
 *
 * @param verifyContent - verify.md body / verify.md 本文
 * @returns The normalised label, or null when none can be extracted / 判定ラベル（抽出できなければ null）
 */
export function extractVerifyClaim(verifyContent: string | null | undefined): string | null {
  if (!verifyContent) return null;
  const lines = verifyContent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!CLAIM_KEY_RE.test(lines[i])) continue;
    const inline = lines[i]
      .replace(/^[#>*\-\s|]+/, '')
      .replace(CLAIM_KEY_RE, '')
      .replace(/^[\s*:：|]+/, '')
      .replace(/[\s*|]+$/, '');
    const value =
      inline ||
      lines
        .slice(i + 1)
        .find((l) => l.trim())
        ?.trim() ||
      '';
    return value ? labelOf(value) : null;
  }
  return null;
}
