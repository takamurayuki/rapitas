/**
 * verify-resolved-failure
 *
 * Recognises a verify.md line that records a failure the same report says was
 * resolved ("❌ 初回失敗・解消済み", "2 failed → 修正済み", "再実行で成功"). Pure.
 * Not responsible for deciding whether a report contradicts itself.
 *
 * NOTE: The honesty gate read every ❌, "N failed" and "exit 1" as a current
 * failure, and grew one exemption per false positive (撤回, 適用不能, 前回…完了,
 * …), each wired into only one of its three detectors. trendline task 1519
 * (2026-11-21) was bounced for a passing report that kept its resolved first
 * attempt as a history row. This is the one rule for "resolved", applied to
 * all three detectors alike.
 */

/** Words saying the failure was resolved within this work. */
const RESOLUTION_RE =
  /解消済|修正済|対応済|解決済|解消した|修正した|解決した|再(?:実行|試行|テスト)で(?:成功|通過|合格|解消)|後に(?:成功|通過|合格)|❌\s*(?:→|->|⇒)\s*✅|passed on retry|now pass(?:es|ing)?|\bresolved\b|\bfixed\b/i;

/**
 * Words saying it is still failing. They win over a resolution word, so
 * "fixed the flake but still failing" and "再実行でも失敗" stay detectable.
 */
const STILL_FAILING_RE =
  /未解消|未解決|未対応|未修正|依然|いまだ|未だ|まだ失敗|今回も|引き続き失敗|再(?:実行|試行)(?:でも|も)(?:失敗|不合格|exit)|still\s+fail|remains?\s+(?:red|failing|broken)|\bunresolved\b|fails? again/i;

/**
 * Whether a line reports a failure that has since been resolved.
 *
 * @param line - One verify.md line / verify.md の1行
 * @returns True when the failure on the line is recorded as resolved / 解消済みの失敗なら true
 */
export function isResolvedFailureLine(line: string): boolean {
  return RESOLUTION_RE.test(line) && !STILL_FAILING_RE.test(line);
}
