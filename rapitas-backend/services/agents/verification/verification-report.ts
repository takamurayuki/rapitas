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
  lines.push('', `対象変更ファイル: ${result.changedFiles.length}件`);
  return lines.join('\n');
}
