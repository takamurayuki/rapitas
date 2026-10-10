/**
 * verify-repair-pollution.test
 *
 * A log-polluted verify.md made self-repair unwinnable. `writeRepairFeedback`
 * reads the prior verify.md and writes `prior + feedback`, so when `prior` is
 * corrupt the pollution is carried into every retry and the validator rejects
 * it again for the identical reason. The feedback block makes it worse: it
 * quotes excerpts from the rejected file, re-injecting the very agent-log lines
 * that failed validation.
 *
 * Measured 2026-10-11 on task 1160: six archived verify.md versions, every one
 * tripping the same three HARD patterns — `[Claude Code]`, `[System: `, and
 * `Process has been unresponsive for` (the 301-second kill notice). Sizes grew
 * 5783 → 6397 → 6402 → 6407 → 6412 → 6417 bytes: the body never changed, only
 * the attempt counter in the appended block. Five bounces, then
 * iteration_budget_halted. The agent was asked to fix a file it was handed
 * still broken.
 *
 * So a corrupt body must be DROPPED, not decorated — and must not be quoted
 * back either, or the block smuggles the pollution past the same gate.
 */
import { describe, expect, it } from 'bun:test';
import { repairFeedbackSources, POLLUTED_BASE_NOTE } from './verify-repair-pollution';

const KILLED_AGENT_LOG = [
  '# 検証レポート',
  '',
  '[Claude Code] Starting execution...',
  '[System: init]',
  '[Tool: Bash] $ pnpm test',
  '[Claude Code] Process has been unresponsive for 303 seconds, treating as hang and force-terminating.',
].join('\n');

const CLEAN_REPORT = [
  '# 検証レポート',
  '',
  '## テスト結果',
  '| 項目 | 結果 |',
  '| --- | --- |',
  '| ユニットテスト | 8/8 passed |',
  '',
  '## 未解決の懸念',
  'なし',
].join('\n');

describe('repairFeedbackSources', () => {
  it('drops a polluted body instead of carrying it into the retry', () => {
    const { base } = repairFeedbackSources(KILLED_AGENT_LOG, KILLED_AGENT_LOG);
    expect(base).toBe(POLLUTED_BASE_NOTE);
    expect(base).not.toContain('[Claude Code]');
    expect(base).not.toContain('Process has been unresponsive');
  });

  it('does not quote a polluted file back into the block', () => {
    // extractFailureDetails would otherwise re-inject the agent-log lines that
    // just failed validation, so the next round fails identically.
    expect(repairFeedbackSources(KILLED_AGENT_LOG, KILLED_AGENT_LOG).quoted).toBeUndefined();
  });

  it('leaves a clean report untouched so real failures stay visible', () => {
    const { base, quoted } = repairFeedbackSources(CLEAN_REPORT, CLEAN_REPORT);
    expect(base).toBe(CLEAN_REPORT);
    expect(quoted).toBe(CLEAN_REPORT);
  });

  it('judges the prior body and the quotable excerpt independently', () => {
    // The stored file can be clean while the rejected content handed in is not
    // (and the reverse), so each is decided on its own merits.
    expect(repairFeedbackSources(CLEAN_REPORT, KILLED_AGENT_LOG)).toEqual({
      base: CLEAN_REPORT,
      quoted: undefined,
    });
    expect(repairFeedbackSources(KILLED_AGENT_LOG, CLEAN_REPORT)).toEqual({
      base: POLLUTED_BASE_NOTE,
      quoted: CLEAN_REPORT,
    });
  });

  it('treats an empty prior as nothing to carry, not as pollution', () => {
    const empty = repairFeedbackSources('', '');
    expect(empty.base).toBe('');
    // Falsy rather than strictly undefined: buildRepairFeedbackBlock gates its
    // excerpt on `verifyContent ? ... : { shown: [] }`, so '' and undefined
    // produce the same (no) excerpt. Pinning one of them would over-specify.
    expect(empty.quoted).toBeFalsy();
    expect(repairFeedbackSources('', CLEAN_REPORT).base).toBe('');
  });

  it('tells the agent why the body is gone', () => {
    // A bare empty file would read as "verify.md was never written"; the note
    // has to say the previous content was discarded and why.
    expect(POLLUTED_BASE_NOTE).toContain('ログ');
    expect(POLLUTED_BASE_NOTE.length).toBeGreaterThan(20);
  });
});
