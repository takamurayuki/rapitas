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

/** Measurement as stored on the timeline payload. */
export interface RecordedMeasurement {
  taskId: number;
  measuredAt: string;
  result: VerificationResult;
}

/**
 * Store one measured verification result for a task. Never throws.
 *
 * @param taskId - Task measured / 対象タスク
 * @param result - Raw automated-verifier result / 自動検証の生の結果
 */
export async function recordVerificationMeasurement(
  taskId: number,
  result: VerificationResult,
): Promise<void> {
  await appendEvent({
    eventType: 'verification_measured',
    actorType: 'system',
    payload: {
      taskId,
      measuredAt: new Date().toISOString(),
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

/**
 * Latest stored measurement for a task, or null when none / unreadable.
 *
 * @param taskId - Task id / タスクID
 * @returns The newest measurement / 最新の実測
 */
export async function loadLatestMeasurement(taskId: number): Promise<RecordedMeasurement | null> {
  try {
    const { events } = await queryEvents({
      eventType: 'verification_measured',
      correlationId: `task-${taskId}`,
      limit: 1,
    });
    const payload = events[0]?.payload as Partial<RecordedMeasurement> | undefined;
    if (!payload?.result || !Array.isArray(payload.result.checks)) return null;
    return {
      taskId,
      measuredAt: String(payload.measuredAt ?? events[0].createdAt),
      result: { ...payload.result, changedFiles: payload.result.changedFiles ?? [] },
    };
  } catch {
    return null;
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

/**
 * verify.md's overall verdict line — the CLAIM only, none of its reasoning.
 *
 * @param verifyContent - verify.md body / verify.md 本文
 * @returns The claim line, or null when no verdict line exists / 総合判定の行
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
    if (inline) return inline.slice(0, 300);
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return next.trim().slice(0, 300);
  }
  return null;
}
