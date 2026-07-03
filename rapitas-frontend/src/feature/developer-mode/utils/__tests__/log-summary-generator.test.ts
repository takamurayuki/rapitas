/**
 * log-summary-generator tests
 *
 * generateExecutionSummary/detectCurrentPhase are already touched lightly by
 * the pre-existing log-message-transformer.test.ts; this file adds the edge
 * cases that were not covered there: transient .wf- scratch file filtering,
 * filesRead tracking, error extraction, cost-without-duration/duration-only
 * parsing, and phase-detection precedence/absence cases.
 */
import { generateExecutionSummary, detectCurrentPhase } from '../log-summary-generator';

describe('generateExecutionSummary', () => {
  test('excludes transient .wf- scratch files from edited/created/read sets', () => {
    const logs = [
      '[Tool: Edit] -> .wf-tmp.md\n[Tool: Edit] -> src/real.ts\n[Tool: Write] -> .wf-concern.json\n[Tool: Read] -> .wf-idea.json\n[Tool: Read] -> src/other.ts',
    ];
    const summary = generateExecutionSummary(logs);
    expect(summary).not.toBeNull();
    expect(summary!.filesEdited).toEqual(['src/real.ts']);
    expect(summary!.filesCreated).toEqual([]);
    expect(summary!.filesRead).toEqual(['src/other.ts']);
  });

  test('collects System Error lines into the errors array (alongside real activity)', () => {
    // NOTE: errors alone are not "significant activity" — the summary is only
    // produced when a file/test/commit is present, so include one edit here.
    const logs = [
      '[Tool: Edit] -> src/a.ts\n[System Error: disk full]\n[System Error: connection reset]',
    ];
    const summary = generateExecutionSummary(logs);
    expect(summary).not.toBeNull();
    expect(summary!.errors).toEqual(['disk full', 'connection reset']);
  });

  test('parses duration and cost from a [Result: ...] line', () => {
    const logs = ['5 tests passed\n[Result: completed (12.5s) $0.0234]'];
    const summary = generateExecutionSummary(logs);
    expect(summary!.durationSeconds).toBe(12.5);
    expect(summary!.costUsd).toBe(0.0234);
  });

  test('parses duration without a cost token', () => {
    const logs = ['1 tests passed\n[Result: completed (3s)]'];
    const summary = generateExecutionSummary(logs);
    expect(summary!.durationSeconds).toBe(3);
    expect(summary!.costUsd).toBeUndefined();
  });

  test('testsRun is the sum of passed and failed, keeping the max seen for each', () => {
    const logs = ['3 tests passed\n7 tests passed\n2 tests failed'];
    const summary = generateExecutionSummary(logs);
    expect(summary!.testsPassed).toBe(7);
    expect(summary!.testsFailed).toBe(2);
    expect(summary!.testsRun).toBe(9);
  });

  test('counts each git commit bash invocation', () => {
    const logs = [
      '[Tool: Bash] $ git commit -m "a"\n[Tool: Bash] $ git commit -m "b"\n[Tool: Bash] $ git status',
    ];
    const summary = generateExecutionSummary(logs);
    expect(summary!.commits).toBe(2);
  });

  test('returns null when there is no significant activity', () => {
    expect(generateExecutionSummary(['just some chatter', 'nothing measurable here'])).toBeNull();
  });

  test('returns null for an empty log array', () => {
    expect(generateExecutionSummary([])).toBeNull();
  });
});

describe('detectCurrentPhase', () => {
  test('later lines take precedence over earlier ones regardless of order in the array', () => {
    expect(detectCurrentPhase(['[verify] check', '[research] look'])).toBe('research');
  });

  test('returns null when no phase marker is present', () => {
    expect(detectCurrentPhase(['no phase markers here at all'])).toBeNull();
  });

  test('splits multi-line log entries before scanning for phase markers', () => {
    expect(detectCurrentPhase(['line one\n[plan] make a plan\nline three'])).toBe('plan');
  });
});
