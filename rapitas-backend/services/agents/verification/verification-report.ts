/**
 * verification-report
 *
 * Renders a VerificationResult as Markdown for verify.md / session error
 * messages. Extracted from automated-verifier.ts (file-size split); contains
 * no verification logic.
 */
import type { VerificationResult } from './automated-verifier';

/**
 * Renders a verification result as a Markdown block for verify.md / reports.
 *
 * @param result - Structured verification result / 検証結果
 * @returns Markdown block / Markdown文字列
 */
export function renderVerificationMarkdown(result: VerificationResult): string {
  const verdict = result.unverifiable
    ? '⚠️ 未検証（ツールを実行できず fail-closed）'
    : result.ok
      ? '✅ 合格'
      : '❌ 失敗（新規エラー検出）';
  const lines = ['## 自動検証結果（lint / 型 / テスト / スコープ）', '', `- 判定: ${verdict}`];
  for (const c of result.checks) {
    const status = c.unverifiable
      ? '⚠️ 未検証（ツール実行不可）'
      : !c.ran
        ? '対象外'
        : c.ok
          ? '✅ OK'
          : `❌ ${c.errorCount}件`;
    lines.push(`- ${c.name}: ${status}`);
    if (!c.ok && c.details) lines.push('', '```', c.details, '```');
  }
  // Render pre-existing failures separately so they are visually distinct from
  // new failures and the reader can immediately see these are not regressions.
  const preExisting = result.checks.find((c) => c.name === 'test')?.preExistingFailures;
  if (preExisting && preExisting.length > 0) {
    lines.push(
      '',
      '### ⚠️ 既存失敗（本変更とは無関係）',
      '',
      '以下のテストはエージェントの変更以前から失敗しており、本変更とは無関係です。懸念バックログに起票済みです。',
      '',
    );
    for (const f of preExisting) {
      lines.push(`- \`${f}\``);
    }
  }
  lines.push('', `対象変更ファイル: ${result.changedFiles.length}件`);
  return lines.join('\n');
}
