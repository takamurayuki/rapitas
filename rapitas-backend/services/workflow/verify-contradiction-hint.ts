/**
 * verify-contradiction-hint
 *
 * Adds one sentence of direction to the "verify.md self-contradicts" verdict
 * when the evidence that tripped it is a line DESCRIBING a failure token rather
 * than asserting a verdict. Owns only that wording: it never decides whether the
 * verdict itself is correct, and it never suppresses a failure.
 *
 * Why the wording matters. The self-contradiction verdict tells the implementer
 * to "fix the implementation", which is right when a real test failed and wrong
 * when the only problem is one line of the verifier's own prose. Task 1112
 * (2026-09-28) fixes the false-positive in this very check, so its changed-files
 * table had to name the token it handles:
 *
 *   | `…/phase-output-validator.ts` | 変更 | `:389` 相当の❌検証失敗判定を…置き換え |
 *
 * The scan saw ❌検証失敗, the verdict said "re-run with stricter test-honesty
 * prompt", and the implementer was sent back to change code that was already
 * correct. Task 1110 spent four rounds and its whole cost ceiling on the same
 * misdirection. The document is repairable in one line — `stripNonEvidenceRegions`
 * drops ```text fences, so the literal can be quoted there — but nothing in the
 * feedback said so.
 */

/**
 * A changed-files row: it names a source file AND carries a Kind cell
 * (`| 変更 |`, `| new |`, …). The Kind cell is what makes this safe — a
 * test-results row can also name a file (`| foo.test.ts | ❌ 3 failed |`) and
 * must NOT be mistaken for a description, or a real failure would be waved
 * through as a wording problem. The evidence arrives wrapped by
 * quoteEvidenceLine, so the row is matched anywhere in the string, not anchored.
 */
const FILE_PATH_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|prisma|md|ya?ml|json)\b/i;
const KIND_CELL_RE = /[|｜]\s*(?:変更|新規|削除|modified|new|added|deleted)\s*[|｜]/i;

function isChangedFilesRow(line: string): boolean {
  return FILE_PATH_RE.test(line) && KIND_CELL_RE.test(line);
}

/**
 * Extra direction for a self-contradiction verdict, or an empty string.
 *
 * Returns a hint only when EVERY quoted piece of evidence looks like a
 * changed-files row: one real failing line among them means the implementation
 * genuinely has to change, and telling the agent to reword would be wrong.
 *
 * @param evidence - The quoted evidence lines the verdict reports. / 判定が引用した根拠行
 * @returns A sentence to append, or '' when the default wording stands. / 追記文、無ければ空文字
 */
export function contradictionRewordHint(evidence: readonly string[]): string {
  if (evidence.length === 0) return '';
  if (!evidence.every(isChangedFilesRow)) return '';
  return (
    ' NOTE: every quoted line above is a changed-files table row, so the token may be ' +
    'DESCRIBING a change rather than reporting a result. If the tests really pass, do not ' +
    'change code for this: reword that row so the token is not asserted as a verdict — quote ' +
    'the literal inside a ```text fence, which this check skips.'
  );
}
