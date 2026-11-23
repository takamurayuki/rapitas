/**
 * plan-identity
 *
 * States which saved plan.md the implementer was given, so it can confirm
 * "this is the approved version" without asking. Pure; no I/O.
 */
import { createHash } from 'crypto';

/**
 * One line identifying the plan by the first 16 hex chars of its sha256 and
 * its length.
 *
 * NOTE: TempoRaid task 1403's implementer stopped twice (2026-11-23) to ask
 * whether the plan in its prompt matched the approved version Rapitas saved —
 * nothing in the prompt said so, and each round needed an operator answer
 * quoting a hash.
 *
 * @param plan - plan.md content as embedded in the prompt / プロンプトに埋め込んだ plan.md
 * @param language - Output language / 出力言語
 * @returns The identity line / 識別行
 */
export function planIdentityLine(plan: string, language: 'ja' | 'en'): string {
  const sha = createHash('sha256').update(plan).digest('hex').slice(0, 16);
  return language === 'ja'
    ? `> この plan.md は Rapitas に保存されている承認済みの最新版そのものです（sha256 先頭16桁 \`${sha}\`、${plan.length} 文字）。照合のために質問する必要はありません。`
    : `> This plan.md is the latest approved version Rapitas has saved (sha256 prefix \`${sha}\`, ${plan.length} characters). There is no need to ask to confirm it.`;
}
