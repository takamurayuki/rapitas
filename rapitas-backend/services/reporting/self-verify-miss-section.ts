/**
 * self-verify-miss-section
 *
 * The daily report's "self-verify misses" section (task 1602): how often a
 * passing self-verify run was later contradicted by a real gate, by kind and
 * by gate, and which mechanical checks to add to the self-verify catalog.
 * Appended AFTER the AI polish so its numbers are never rewritten. Not
 * responsible for recording misses.
 */
import { createLogger } from '../../config/logger';
import type { MissBreakdown, SelfVerifyMissSummary } from '../workflow/self-verify-miss';

const log = createLogger('reporting:self-verify-miss');

const KIND_LABEL: Record<string, string> = {
  mechanical: 'mechanical（機械の検査）',
  judgment: 'judgment（判断）',
};
const STATUS_LABEL: Record<string, string> = {
  partial: '一部だけ覆っている',
  missing: '一覧にない',
};

/** `50.0%（2/4）`, or `—` when no run passed. */
function rateText(missedRuns: number, passedRuns: number): string {
  if (passedRuns === 0) return '—';
  return `${((missedRuns / passedRuns) * 100).toFixed(1)}%（${missedRuns}/${passedRuns}）`;
}

const row = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;

/**
 * Render the section.
 *
 * @param s - Summary, or null when the ledger could not be read / 集計
 * @returns Markdown section / Markdown の節
 */
export function formatSelfVerifyMissSection(s: SelfVerifyMissSummary | null): string {
  const head = '## 自己検証の見落とし';
  if (!s) return `${head}\n\n見落としの記録を集計できませんでした。`;
  const rate = (b: MissBreakdown) => rateText(b.missedRuns, s.passedRuns);
  const lines = [
    head,
    '',
    `合格した自己検証 ${s.passedRuns}回、見落とし ${s.misses}件` +
      `（後で本物のゲートで落ちた合格 ${s.missedRuns}回、割合 ${rateText(s.missedRuns, s.passedRuns)}）。`,
    '',
    row(['種類', '件数', '後で落ちた合格', '割合']),
    row(['---', '---', '---', '---']),
    ...s.byKind.map((k) => row([KIND_LABEL[k.key] ?? k.key, k.misses, k.missedRuns, rate(k)])),
  ];
  if (s.byGate.length > 0) {
    lines.push('', row(['ゲート', '種類', '件数', '割合']), row(['---', '---', '---', '---']));
    for (const g of s.byGate) lines.push(row([g.key, g.kind, g.misses, rate(g)]));
  }
  if (s.candidates.length > 0) {
    lines.push(
      '',
      '### 自己検証に足す候補',
      '',
      '機械の検査の見落としのうち、自己検証の一覧が覆っていない検査です。',
      '',
      row(['ゲート', '判定', '未対応の検査']),
      row(['---', '---', '---']),
    );
    for (const c of s.candidates) {
      const steps = c.uncoveredSteps.length > 0 ? c.uncoveredSteps.join(', ') : '—';
      lines.push(row([c.gate, STATUS_LABEL[c.status] ?? c.status, steps]));
    }
  }
  return lines.join('\n');
}

/**
 * Append the section to a (possibly AI-polished) report body.
 *
 * @param body - Report Markdown / レポート本文
 * @param s - Summary or null / 集計
 * @returns Body plus the section / 節を足した本文
 */
export function appendSelfVerifyMissSection(body: string, s: SelfVerifyMissSummary | null): string {
  return `${body.trimEnd()}\n\n${formatSelfVerifyMissSection(s)}`;
}

/**
 * Read the window's summary; null (never a throw) when the ledger is unreadable,
 * so the daily report still ships.
 *
 * @param since - Window start / 窓の開始
 * @param until - Window end / 窓の終了
 * @returns Summary or null / 集計
 */
export async function loadSelfVerifyMissSummary(
  since: Date,
  until: Date,
): Promise<SelfVerifyMissSummary | null> {
  try {
    const { summarizeSelfVerifyMisses } = await import('../workflow/self-verify-miss');
    return await summarizeSelfVerifyMisses({ since, until });
  } catch (err) {
    log.warn({ err }, '[daily-report] Self-verify miss summary unavailable');
    return null;
  }
}
