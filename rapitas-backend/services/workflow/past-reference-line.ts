/**
 * past-reference-line
 *
 * Pure predicate recognising a verify.md prose line that cites a past ❌ as
 * already resolved ("前回 ❌ だった項目は今回すべて完了"). Not responsible for
 * deciding whether a verify.md is self-contradictory.
 */

const PAST_MARKER = /前回|以前|先ほど|先の|旧|過去|かつて|previously|earlier|last time|before/i;
const RESOLUTION_MARKER = /完了|解消|対応済|修正済|解決|クリア|消えた|resolved|fixed|cleared|done/i;
// A present-tense failure word keeps the line detectable (mixed "was done, now ❌" lines).
const CURRENT_FAILURE_MARKER =
  /今回も|依然|未だ|まだ|引き続き|未達|未完了|未解決|失敗|still|remains|again/i;

/**
 * Whether a line mentions ❌ only as a past state that has since been resolved.
 *
 * @param line - One line of verify.md. / verify.md の1行
 * @returns true when the ❌ is a past reference, not a current failure. / 過去参照なら true
 */
export function isPastReferenceLine(line: string): boolean {
  return (
    line.includes('❌') &&
    PAST_MARKER.test(line) &&
    RESOLUTION_MARKER.test(line) &&
    !CURRENT_FAILURE_MARKER.test(line)
  );
}
