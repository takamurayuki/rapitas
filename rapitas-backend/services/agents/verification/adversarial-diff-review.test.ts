/**
 * adversarial-diff-review.test
 *
 * Unit tests for the independent judge: the pure prompt builder + verdict
 * parser, the enable/disable flag, and the orchestration function's fail-open
 * branches / cross-provider judge selection. All heavy infrastructure (git
 * diff, AI client, prisma, workflow file reads, logger) is mocked at the
 * module boundary BEFORE the module under test is imported, so importing this
 * file never reaches the real database (config/database eagerly connects on
 * import if not mocked first).
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const getDiff = mock(() =>
  Promise.resolve([{ filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+line' }]),
);
const sendAIMessage = mock(() =>
  Promise.resolve({ content: '{"verdict":"pass","severity":0,"reasons":[]}' }),
);
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/wf/1' }));
const readWorkflowFile = mock(() => Promise.resolve('plan content'));
const agentExecutionFindFirst = mock(() => Promise.resolve(null));
const taskFindUnique = mock(() => Promise.resolve({ title: 'Task', acceptanceCriteria: null }));
const agentExecutionConfigFindUnique = mock(() => Promise.resolve(null));

mock.module('../orchestrator/git-operations/core/diff-structured', () => ({ getDiff }));
mock.module('../../../utils/ai-client', () => ({ sendAIMessage }));
mock.module('../../workflow/workflow-file-utils', () => ({ resolveWorkflowDir, readWorkflowFile }));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findFirst: agentExecutionFindFirst },
    agentExecutionConfig: { findUnique: agentExecutionConfigFindUnique },
    task: { findUnique: taskFindUnique },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const {
  buildDiffReviewPrompt,
  parseReviewVerdict,
  isAdversarialReviewEnabled,
  reviewDiffAdversarially,
} = await import('./adversarial-diff-review');

describe('buildDiffReviewPrompt', () => {
  it('embeds task title, plan, acceptance criteria, and diff text', () => {
    const prompt = buildDiffReviewPrompt({
      taskTitle: 'Fix the login bug',
      planContent: 'Edit `src/login.ts` to validate the token.',
      acceptanceCriteria: ['Login rejects expired tokens', 'Existing tests still pass'],
      diffText: '--- a/src/login.ts\n+++ b/src/login.ts\n+if (expired) throw new Error();',
    });
    expect(prompt).toContain('Fix the login bug');
    expect(prompt).toContain('src/login.ts');
    expect(prompt).toContain('1. Login rejects expired tokens');
    expect(prompt).toContain('2. Existing tests still pass');
    expect(prompt).toContain('if (expired) throw new Error()');
    expect(prompt).toContain('JSONオブジェクトのみ');
  });

  it('falls back to a placeholder when there are no acceptance criteria', () => {
    const prompt = buildDiffReviewPrompt({
      taskTitle: 'T',
      planContent: '',
      acceptanceCriteria: [],
      diffText: 'diff',
    });
    expect(prompt).toContain('(明示的な受入基準なし');
    expect(prompt).toContain('(計画なし)');
  });

  it('truncates an overlong plan to 6000 chars', () => {
    const longPlan = 'x'.repeat(7000);
    const prompt = buildDiffReviewPrompt({
      taskTitle: 'T',
      planContent: longPlan,
      acceptanceCriteria: [],
      diffText: 'd',
    });
    // The plan section should not contain the full 7000-char run.
    const planSection = prompt.split('## 受入基準')[0];
    expect(planSection.length).toBeLessThan(6200);
  });
});

describe('parseReviewVerdict', () => {
  it('returns unknown for null/undefined/empty text', () => {
    expect(parseReviewVerdict(null)).toEqual({
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
    });
    expect(parseReviewVerdict(undefined)).toEqual({
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
    });
    expect(parseReviewVerdict('   ')).toEqual({
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
    });
  });

  it('returns unknown when there is no JSON object in the text', () => {
    expect(parseReviewVerdict('no braces here')).toEqual({
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
    });
  });

  it('returns unknown for an unbalanced/unterminated object', () => {
    expect(parseReviewVerdict('{"verdict":"fail"').judged).toBe(false);
  });

  it('returns unknown for malformed JSON inside balanced braces', () => {
    expect(parseReviewVerdict('{"verdict": fail, oops}').verdict).toBe('unknown');
  });

  it('parses a clean pass verdict', () => {
    const r = parseReviewVerdict('{"verdict":"pass","severity":0,"reasons":[]}');
    expect(r).toEqual({ verdict: 'pass', severity: 0, reasons: [], judged: true });
  });

  it('parses a clean fail verdict with reasons', () => {
    const r = parseReviewVerdict(
      '{"verdict":"fail","severity":65,"reasons":["missing edge case handling"]}',
    );
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(65);
    expect(r.reasons).toEqual(['missing edge case handling']);
    expect(r.judged).toBe(true);
  });

  it('tolerates prose/code-fences around the JSON object', () => {
    const text =
      'Here is my review:\n```json\n{"verdict":"pass","severity":0,"reasons":[]}\n```\nDone.';
    const r = parseReviewVerdict(text);
    expect(r.verdict).toBe('pass');
  });

  it('is case-insensitive on the verdict field', () => {
    expect(parseReviewVerdict('{"verdict":"FAIL"}').verdict).toBe('fail');
    expect(parseReviewVerdict('{"verdict":"Pass"}').verdict).toBe('pass');
  });

  it('treats an unrecognized verdict string as unknown', () => {
    const r = parseReviewVerdict('{"verdict":"maybe","severity":10}');
    expect(r.verdict).toBe('unknown');
    expect(r.judged).toBe(false);
  });

  it('defaults severity to 80 for a fail with no numeric severity', () => {
    expect(parseReviewVerdict('{"verdict":"fail"}').severity).toBe(80);
  });

  it('defaults severity to 0 for a pass with no numeric severity', () => {
    expect(parseReviewVerdict('{"verdict":"pass"}').severity).toBe(0);
  });

  it('clamps severity into [0, 100]', () => {
    expect(parseReviewVerdict('{"verdict":"fail","severity":500}').severity).toBe(100);
    expect(parseReviewVerdict('{"verdict":"fail","severity":-50}').severity).toBe(0);
  });

  it('filters non-string reasons and caps the list at 10', () => {
    const reasons = [...Array(15)].map((_, i) => `reason-${i}`);
    const r = parseReviewVerdict(
      JSON.stringify({ verdict: 'fail', severity: 50, reasons: [1, null, ...reasons] }),
    );
    expect(r.reasons).toHaveLength(10);
    expect(r.reasons[0]).toBe('reason-0');
  });

  it('defaults reasons to [] when the field is missing or not an array', () => {
    expect(parseReviewVerdict('{"verdict":"fail","reasons":"oops"}').reasons).toEqual([]);
    expect(parseReviewVerdict('{"verdict":"fail"}').reasons).toEqual([]);
  });

  it('extracts the first balanced object even with nested braces before it closes', () => {
    const text = '{"verdict":"fail","severity":30,"reasons":["uses {curly} in a string"]}';
    const r = parseReviewVerdict(text);
    expect(r.verdict).toBe('fail');
    expect(r.reasons[0]).toContain('{curly}');
  });
});

describe('isAdversarialReviewEnabled', () => {
  const ENV_KEY = 'RAPITAS_ADVERSARIAL_REVIEW';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('is enabled by default (unset)', () => {
    delete process.env[ENV_KEY];
    expect(isAdversarialReviewEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'off'])('is disabled for %s', (v) => {
    process.env[ENV_KEY] = v;
    expect(isAdversarialReviewEnabled()).toBe(false);
  });

  it('is enabled for any other value', () => {
    process.env[ENV_KEY] = 'yes-please';
    expect(isAdversarialReviewEnabled()).toBe(true);
  });
});

describe('reviewDiffAdversarially', () => {
  beforeEach(() => {
    getDiff.mockReset();
    sendAIMessage.mockReset();
    resolveWorkflowDir.mockReset();
    readWorkflowFile.mockReset();
    agentExecutionFindFirst.mockReset();
    taskFindUnique.mockReset();
    agentExecutionConfigFindUnique.mockReset();
    getDiff.mockReset();
    getDiff.mockResolvedValue([
      { filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+line' },
    ]);
    sendAIMessage.mockResolvedValue({ content: '{"verdict":"pass","severity":0,"reasons":[]}' });
    resolveWorkflowDir.mockResolvedValue({ dir: '/wf/1' });
    readWorkflowFile.mockResolvedValue('plan content');
    agentExecutionFindFirst.mockResolvedValue(null);
    taskFindUnique.mockResolvedValue({ title: 'Task', acceptanceCriteria: null });
    agentExecutionConfigFindUnique.mockResolvedValue(null);
    delete process.env.RAPITAS_ADVERSARIAL_REVIEW;
  });

  it('fails open (unknown, not judged) when disabled via env', async () => {
    process.env.RAPITAS_ADVERSARIAL_REVIEW = '0';
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(r).toEqual({ verdict: 'unknown', severity: 0, reasons: [], judged: false });
    expect(getDiff).not.toHaveBeenCalled();
  });

  it('fails open when there is no worktree path', async () => {
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: null });
    expect(r.judged).toBe(false);
  });

  it('fails open when there is no diff at all (nothing to review)', async () => {
    // An empty file list is the only way diffText.trim() is empty — each mapped
    // entry always carries a non-blank "--- file (status, +a/-d)" header line
    // even when patch is ''.
    getDiff.mockResolvedValue([]);
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(r.judged).toBe(false);
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  it('returns a judged pass verdict on a normal successful call', async () => {
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    // Every juror is queried independently in parallel (no early exit) — use
    // toMatchObject rather than toEqual so this doesn't hardcode the jurors[]
    // array's exact contents/order.
    expect(r).toMatchObject({ verdict: 'pass', severity: 0, reasons: [], judged: true });
    expect(sendAIMessage).toHaveBeenCalledTimes(3);
  });

  it('fails open when every judge provider throws', async () => {
    sendAIMessage.mockRejectedValue(new Error('provider down'));
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(r).toMatchObject({ verdict: 'unknown', severity: 0, reasons: [], judged: false });
    // All 3 configured judge providers were attempted.
    expect(sendAIMessage).toHaveBeenCalledTimes(3);
  });

  it('falls through to the next provider when one returns an unparseable reply', async () => {
    sendAIMessage
      .mockResolvedValueOnce({ content: 'not json at all' })
      .mockResolvedValueOnce({ content: '{"verdict":"fail","severity":90,"reasons":["bad"]}' });
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(r.verdict).toBe('fail');
    // All 3 jurors are queried in parallel regardless (2 explicit mocks + the
    // 3rd falls back to the default 'pass' set in beforeEach).
    expect(sendAIMessage).toHaveBeenCalledTimes(3);
  });

  it('fails open when the diff-review pipeline throws unexpectedly', async () => {
    getDiff.mockRejectedValue(new Error('git blew up'));
    const r = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(r).toEqual({ verdict: 'unknown', severity: 0, reasons: [], judged: false });
  });

  it('prefers task.theme.defaultBranch over AgentExecutionConfig.targetBranch as preferredBaseBranch', async () => {
    // Regression test for task 506/511: resolveBaseRef's develop→main→master
    // GUESS can land on a stale/divergent branch and pull unrelated
    // pre-existing commits into "this task's diff" — misread as scope creep
    // by the jury. task 511 additionally found AgentExecutionConfig is empty
    // for the entire autonomous pipeline, so theme.defaultBranch (populated
    // for every task) must be tried FIRST, not the config-only source.
    taskFindUnique.mockResolvedValue({ theme: { defaultBranch: 'release/1.2' } });
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(getDiff).toHaveBeenCalledWith('/wt', undefined, 'release/1.2');
    // Short-circuits — AgentExecutionConfig is never even queried when the
    // theme already supplies a default branch.
    expect(agentExecutionConfigFindUnique).not.toHaveBeenCalled();
  });

  it('falls back to AgentExecutionConfig.targetBranch when the theme has no default branch', async () => {
    taskFindUnique.mockResolvedValue({ theme: null });
    agentExecutionConfigFindUnique.mockResolvedValue({ targetBranch: 'release/1.2' });
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(getDiff).toHaveBeenCalledWith('/wt', undefined, 'release/1.2');
  });

  it('passes undefined preferredBaseBranch when neither theme nor AgentExecutionConfig provide one', async () => {
    taskFindUnique.mockResolvedValue({ theme: null });
    agentExecutionConfigFindUnique.mockResolvedValue(null);
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(getDiff).toHaveBeenCalledWith('/wt', undefined, undefined);
  });

  it("orders the implementer's own provider LAST among judge candidates", async () => {
    // The implementer used claude — the judge should try gemini/chatgpt first.
    agentExecutionFindFirst.mockResolvedValue({ modelName: 'claude-3-5-sonnet' });
    const calledProviders: string[] = [];
    sendAIMessage.mockImplementation((opts: { provider: string }) => {
      calledProviders.push(opts.provider);
      return Promise.resolve({ content: '{"verdict":"pass","severity":0,"reasons":[]}' });
    });
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    // First call must NOT be 'claude' (the implementer's own provider).
    expect(calledProviders[0]).not.toBe('claude');
  });
});
