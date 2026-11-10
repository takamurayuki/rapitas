/**
 * verifier-seat
 *
 * The third, non-voting seat of the two-reviewer jury: it is shown only the
 * findings the reviewers disagreed on and checks each one's grounds against
 * the diff (follow the repro on the code, read the cited lines, try to build a
 * counterexample), answering holds / refuted / undetermined per finding.
 * Not responsible for deciding the review (two-seat-review.ts).
 *
 * NOTE: Like the reviewers, this seat is a single LLM call with no tools or
 * repository access — "running" a repro means tracing it through the diff
 * shown, not executing it. Anything that needs execution to decide is exactly
 * what 'undetermined' is for, and that goes to a human.
 */
import { sendAIMessage } from '../../../utils/ai-client';
import { createLogger } from '../../../config/logger';
import type { JurorSpec } from './jury-panel';
import type { ReviewFinding } from './review-findings';
import type { FindingVerification } from './jury-seat-types';
import type { FindingCheck } from './two-seat-review';
import type { JurorUsage } from './adversarial-diff-review-verdict';
import type { UnknownReason } from './juror-unknown-reason';
import { jurorTimeoutMs, recordJurorOutcome } from './juror-call';

const log = createLogger('verification:verifier-seat');

/**
 * Build the verifier prompt. Shows the disputed findings WITHOUT who raised
 * them or how anyone voted, so the seat checks grounds instead of siding.
 *
 * @param p - Task title, criteria, plan, diff text and the disputed findings / 入力
 * @returns Prompt body / プロンプト本文
 */
export function buildVerifierPrompt(p: {
  taskTitle: string;
  acceptanceCriteria: string[];
  planContent: string;
  diffText: string;
  disputed: ReviewFinding[];
}): string {
  const ac =
    p.acceptanceCriteria.length > 0
      ? p.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(明示的な受入基準なし)';
  const items = p.disputed
    .map((f, i) =>
      [
        `${i + 1}. [${f.severity}] ${f.summary}`,
        f.criterion ? `   対応する受入基準: ${f.criterion}` : null,
        `   根拠として示された箇所: ${f.evidence ?? '(なし)'}`,
        f.repro ? `   示された再現手順: ${f.repro}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
  return `あなたは検証担当です。別の担当者が下記の差分について指摘を出しました。あなたの仕事は、指摘ごとに**その根拠が本当に成り立つか**を確かめることだけです。差分全体の良し悪しを判定する必要はありません。

## タスク
${p.taskTitle}

## 受入基準
${ac}

## 計画 (plan.md 抜粋)
${p.planContent.slice(0, 3000) || '(計画なし)'}

## 最終差分 (git diff)
\`\`\`diff
${p.diffText}
\`\`\`

## 確かめる指摘
${items}

## 確かめ方
- 示された箇所が差分のどこに当たるかを読み、指摘どおりの欠陥がそこに実在するかを確認する。
- 再現手順があれば、差分のコードの上でその手順をたどり、指摘どおりの結果になるかを確かめる。
- 指摘を否定できる反例（その入力では問題が起きない理由、別の箇所で既に処理されている等）を差分の中に探す。
- 差分に写っていないコードや実行結果が無いと決められない場合は、推測で決めずに「undetermined」とする。

## 出力（厳守）
JSON オブジェクトのみを出力する（前置き不要）:
{"results":[{"index":1,"status":"holds"|"refuted"|"undetermined","note":"判断の根拠を1文で（差分の箇所を引用）"}]}
- holds = 根拠が成り立つ（欠陥が差分に実在する）。refuted = 根拠が成り立たない（反例・誤読）。undetermined = 差分からは判定できない。
- 上の番号すべてについて1件ずつ書く。`;
}

const STATUS_WORDS: ReadonlyArray<[RegExp, FindingVerification]> = [
  [/^(?:holds?|valid|confirmed|成り立つ|成立)$/i, 'holds'],
  [/^(?:refuted|invalid|rejected|成り立たない|不成立)$/i, 'refuted'],
];

function normaliseStatus(raw: unknown): FindingVerification {
  const s = typeof raw === 'string' ? raw.trim() : '';
  for (const [re, v] of STATUS_WORDS) if (re.test(s)) return v;
  return 'undetermined';
}

/**
 * Parse the verifier's reply. Tolerant of fences/prose around the JSON.
 *
 * @param text - Raw reply / 生の返答
 * @param count - Number of disputed findings shown / 提示した争点の数
 * @returns Checks for in-range indices, or null when unreadable / 読めなければ null
 */
export function parseVerifierReply(
  text: string | null | undefined,
  count: number,
): FindingCheck[] | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { results?: unknown };
    if (!Array.isArray(obj.results)) return null;
    const out: FindingCheck[] = [];
    for (const item of obj.results) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const index = typeof o.index === 'number' ? o.index : Number(o.index);
      if (!Number.isInteger(index) || index < 1 || index > count) continue;
      const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 400) : null;
      out.push({ index, status: normaliseStatus(o.status), ...(note ? { note } : {}) });
    }
    return out;
  } catch {
    return null;
  }
}

/** What the verifier seat returned. */
export interface VerifierAnswer {
  /** null when the seat did not answer (timeout / error / unreadable). */
  checks: FindingCheck[] | null;
  unknownReason?: UnknownReason;
  usage?: JurorUsage;
}

/**
 * Ask the verifier seat. Never throws; shares the juror deadline and the
 * juror timeout history (a seat that keeps timing out is rested the same way).
 *
 * @param seat - Seat to ask / 問い合わせる席
 * @param prompt - buildVerifierPrompt() output / プロンプト
 * @param count - Number of disputed findings / 争点の数
 * @returns The checks, or null checks with the reason / 検証結果
 */
export async function askVerifier(
  seat: JurorSpec,
  prompt: string,
  count: number,
): Promise<VerifierAnswer> {
  const startedAt = new Date();
  const timeoutMs = jurorTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sendAIMessage({
        provider: seat.provider,
        model: seat.model,
        systemPrompt: 'You are a careful verifier who checks claims against code evidence.',
        maxTokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }).then((res): VerifierAnswer => {
        recordJurorOutcome(seat.label, false, Date.now());
        const checks = parseVerifierReply(res.content, count);
        return {
          checks,
          ...(checks ? {} : { unknownReason: 'unparsable' as const }),
          usage: {
            costUsd: res.costUsd,
            tokensUsed: res.tokensUsed ?? 0,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            cacheReadInputTokens: res.cacheReadInputTokens,
            cacheCreationInputTokens: res.cacheCreationInputTokens,
            modelName: res.modelName,
            startedAt,
            durationMs: Date.now() - startedAt.getTime(),
          },
        };
      }),
      new Promise<VerifierAnswer>((resolve) => {
        timer = setTimeout(() => {
          recordJurorOutcome(seat.label, true, Date.now());
          log.warn({ seat: seat.label, timeoutMs }, '[verifier-seat] Verifier timed out');
          resolve({ checks: null, unknownReason: 'timeout' });
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    log.warn({ err, seat: seat.label }, '[verifier-seat] Verifier failed');
    return { checks: null, unknownReason: 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
