/**
 * verify-previous-round
 *
 * Builds the verifier's "previous round" context: what the last verify.md left
 * open, what it passed with evidence, and why the round was sent back. Not
 * responsible for deciding the verdict; the verifier still re-measures.
 *
 * NOTE: Each round used to judge from scratch, with neither the previous
 * verify.md nor the rejection in its context, and the verifier model changes
 * between rounds (task 521: gpt-6.1-sol, claude-opus-5-5, gpt-6-astra). A new
 * model could re-judge an item that had already passed with evidence, or miss
 * what the last round sent back (2026-11-21).
 */
import { prisma } from '../../config/database';
import { readWorkflowFile } from './workflow-file-utils';
import { collectNonpassingRows, stripNonEvidenceRegions } from './verify-scan-text';

const MAX_ROWS = 12;
const MAX_REASON_CHARS = 800;

/** Table rows the previous report marked as passed. */
function passedRows(content: string): string[] {
  return stripNonEvidenceRegions(content)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.includes('✅') && !/全体判定|overall/i.test(l))
    .slice(0, MAX_ROWS);
}

/** Why the last round was sent back, from the newest repair bounce. */
async function lastRejection(taskId: number): Promise<string | null> {
  const row = await prisma.workflowTransition
    .findFirst({
      where: { taskId, cause: 'verify_repair' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    })
    .catch(() => null);
  if (!row?.metadata) return null;
  try {
    const meta = JSON.parse(String(row.metadata)) as { reason?: unknown };
    return typeof meta.reason === 'string' ? meta.reason.slice(0, MAX_REASON_CHARS) : null;
  } catch {
    return null;
  }
}

/**
 * The previous round's results for the verifier, or '' on the first round.
 *
 * @param taskId - Task being verified / 検証対象のタスク
 * @param language - Output language / 出力言語
 * @returns Markdown section, or '' when there is no previous report / 前回結果の節（初回は空）
 */
export async function buildPreviousRoundSection(
  taskId: number,
  language: 'ja' | 'en',
): Promise<string> {
  const previous = await readWorkflowFile(taskId, 'verify').catch(() => null);
  if (!previous?.trim()) return '';
  const open = collectNonpassingRows(previous).slice(0, MAX_ROWS);
  const passed = passedRows(previous);
  const reason = await lastRejection(taskId);
  const list = (rows: string[]) => (rows.length ? rows.map((r) => `- ${r}`).join('\n') : '- なし');

  if (language === 'en') {
    return [
      '## Previous verification round (carry-over)',
      'A previous verify.md exists for this task. Use it as follows:',
      '1. First check whether each open item and the rejection reason below is fixed, and report each one.',
      '2. A previously passed item whose files and logic the current diff does not touch may keep its verdict; mark it "前回判定を引継ぎ (carried over)". Re-check it if the diff touches it.',
      '3. Lint, typecheck and tests are measured anew every round (毎回取り直す); never carry them over.',
      reason ? `\n### Why the last round was sent back\n${reason}` : '',
      `\n### Open items (未達) in the previous report\n${list(open)}`,
      `\n### Items that passed (合格した項目) in the previous report\n${list(passed)}`,
    ].join('\n');
  }
  return [
    '## 前回の検証結果（引き継ぎ）',
    'このタスクには前回の verify.md がある。次のとおり使うこと。',
    '1. 下の「前回の未達項目」と「差し戻しの理由」が直ったかを最初に確かめ、項目ごとに結果を書く。',
    '2. 前回合格した項目は、今回の差分がその項目のファイル・処理に触れていなければ、前回の判定を引き継いでよい。引き継いだ項目には「前回判定を引継ぎ」と明記する。差分が触れていれば確かめ直す。',
    '3. lint・型チェック・テストの実測は毎回取り直す。引き継がない。',
    reason ? `\n### 差し戻しの理由\n${reason}` : '',
    `\n### 前回の未達項目\n${list(open)}`,
    `\n### 前回合格した項目\n${list(passed)}`,
  ].join('\n');
}
