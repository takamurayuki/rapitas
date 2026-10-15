/**
 * verify-exit-signal
 *
 * Decides whether one verify.md line is a test RUNNER's non-zero exit report
 * ("exit 1") rather than prose that merely mentions an exit code. Pure; used
 * by the verify.md honesty gate.
 */

/** Japanese characters that turn "exit 1" into a clause of prose. */
const JA_CHAR_RE = /[ぁ-んァ-ヶ一-龥々]/;

/** Japanese particles that, right before "exit 1", make it the object of a sentence. */
const JA_PARTICLE_BEFORE_RE = /[はがをにのとなもへで]\s*$/;

/**
 * "exit 1" / "exit code 1" counts as a failure ONLY when it reads like a
 * RUNNER's exit report — not when it is PROSE documenting a command's expected
 * exit code. CI-gate / error-handling / guard tasks legitimately describe exit
 * codes as EVIDENCE the guard works ("空マニフェスト(exit 1)", "不正な入力で exit 1
 * を返す"); reading those as the task's own failure looped them in verify_repair
 * (task 272/304/373/376). Skip a match that is parenthesised, embedded in a
 * Japanese sentence on either side (task 981 "無関係な exit 1・既存の…", task 999
 * "`git merge-base …` は exit 1。PR マージ後に…"), or on a line that also
 * asserts pass or enumerates both exit codes.
 *
 * @param line - One verify.md line / verify.md の1行
 * @returns True when the line reports a real non-zero exit / 実失敗なら true
 */
export function isRunnerExitFailureLine(line: string): boolean {
  const m = line.match(/\bexit(?:\s+code)?\s+1\b/i);
  if (!m) return false;
  if (/✅|合格|通過|成功|pass/i.test(line)) return false; // pass-asserting line
  // A line enumerating BOTH exit codes is a spec of expected outcomes, not one
  // run's result: task 647's DoD read "build 後 verify 一致→exit 0、改ざん→
  // exit 1＋資産名". The trailing-prose guard below missed it because the next
  // character is a fullwidth ＋ rather than a kana, so it blocked a passing
  // report on the very behaviour the task implemented.
  if (/\bexit(?:\s+code)?\s+0\b/i.test(line)) return false;
  const idx = m.index ?? 0;
  const before = line.slice(0, idx);
  if (/[(（]\s*$/.test(before)) return false; // "(exit 1)"
  if (JA_PARTICLE_BEFORE_RE.test(before)) return false; // "…は exit 1"
  const after = line.slice(idx + m[0].length).replace(/^[)）\s]+/, '');
  // "exit 1 を返す" / "exit 1。" / "exit 1・既存の…" — prose continues in Japanese.
  if (JA_CHAR_RE.test(after.charAt(0)) || /^[。、・，．」』]/.test(after)) return false;
  return true;
}
