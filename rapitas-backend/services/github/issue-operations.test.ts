/**
 * issue-operations.test
 *
 * Tests for createIssue, addIssueComment, and ensureLabelsExist:
 * - Normal creation with and without labels
 * - Body is passed via runGhCommandWithBody (--body-file) not runGhCommand
 * - Label-less fallback when gh issue create --label fails
 * - ensureLabelsExist warn/silent behavior
 * - addIssueComment delegates to runGhCommandWithBody
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRunGhCommand = mock(() => Promise.resolve(''));
const mockRunGhCommandWithBody = mock(() => Promise.resolve(''));
const mockWarn = mock(() => {});
const mockError = mock(() => {});

mock.module('./gh-client', () => ({
  runGhCommand: mockRunGhCommand,
  runGhCommandWithBody: mockRunGhCommandWithBody,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mockWarn,
    error: mockError,
  }),
}));

const { createIssue, addIssueComment } = await import('./issue-operations');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ISSUE_URL = 'https://github.com/owner/repo/issues/42';

const ISSUE_JSON = JSON.stringify({
  number: 42,
  title: 'Auth flaw',
  body: 'JWT not validated',
  state: 'OPEN',
  labels: [{ name: 'type:security' }, { name: 'priority:high' }],
  author: { login: 'bot' },
  url: ISSUE_URL,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

// ─── Reset helper ──────────────────────────────────────────────────────────────

function resetMocks() {
  mockRunGhCommand.mockReset();
  mockRunGhCommandWithBody.mockReset();
  mockWarn.mockReset();
  mockError.mockReset();
}

// ─── createIssue ─────────────────────────────────────────────────────────────

describe('createIssue', () => {
  beforeEach(resetMocks);

  it('正常系: ラベルあり → ensureLabels + runGhCommandWithBody が呼ばれ Issue を返す', async () => {
    // label create calls use runGhCommand; issue create uses runGhCommandWithBody
    mockRunGhCommand
      .mockResolvedValueOnce('') // label create type:security
      .mockResolvedValueOnce('') // label create priority:high
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL); // issue create

    const issue = await createIssue('owner/repo', {
      title: 'Auth flaw',
      body: 'JWT not validated',
      labels: ['type:security', 'priority:high'],
    });

    expect(issue.number).toBe(42);
    expect(issue.labels).toContain('type:security');
    // issue create is via runGhCommandWithBody, not runGhCommand
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [createArgs, createBody] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string];
    expect(createArgs).toContain('--label');
    expect(createArgs).toContain('type:security,priority:high');
    expect(createArgs).not.toContain('--body');
    expect(createBody).toBe('JWT not validated');
  });

  it('正常系: ラベルなし → label create をスキップ', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL); // issue create
    mockRunGhCommand.mockResolvedValueOnce(ISSUE_JSON); // issue view

    const issue = await createIssue('owner/repo', { title: 'Auth flaw' });

    expect(issue.number).toBe(42);
    // Only issue view uses runGhCommand; no label calls
    expect(mockRunGhCommand).toHaveBeenCalledTimes(1);
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [createArgs] = mockRunGhCommandWithBody.mock.calls[0] as [string[]];
    expect(createArgs).not.toContain('--label');
    expect(createArgs).not.toContain('--body');
  });

  it('正常系: body なし → runGhCommandWithBody に undefined を渡す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL);
    mockRunGhCommand.mockResolvedValueOnce(ISSUE_JSON);

    await createIssue('owner/repo', { title: 'No body' });

    const [, createBody] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string | undefined];
    expect(createBody).toBeUndefined();
  });

  it('フォールバック: ラベル付きが失敗したらラベルなしで再試行して成功', async () => {
    mockRunGhCommand
      .mockResolvedValueOnce('') // label create type:security
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    mockRunGhCommandWithBody
      .mockRejectedValueOnce(new Error('Could not resolve to a Label')) // issue create with labels
      .mockResolvedValueOnce(ISSUE_URL); // issue create without labels (fallback)

    const issue = await createIssue('owner/repo', {
      title: 'Auth flaw',
      labels: ['type:security'],
    });

    expect(issue.number).toBe(42);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const warnCall = mockWarn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ repo: 'owner/repo', labels: ['type:security'] });
    expect(warnCall[1]).toContain('retrying without labels');
    // 2 withBody calls: with-labels (fail) + without-labels (success)
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(2);
    // Fallback call should not have --label
    const [fallbackArgs] = mockRunGhCommandWithBody.mock.calls[1] as [string[]];
    expect(fallbackArgs).not.toContain('--label');
  });

  it('フォールバック後も失敗 → throw', async () => {
    mockRunGhCommand.mockResolvedValueOnce(''); // label create

    mockRunGhCommandWithBody
      .mockRejectedValueOnce(new Error('Label missing')) // issue create with labels
      .mockRejectedValueOnce(new Error('gh: API error 401')); // fallback also fails

    await expect(
      createIssue('owner/repo', { title: 'Auth flaw', labels: ['type:security'] }),
    ).rejects.toThrow('gh: API error 401');
  });

  it('ラベルなしで失敗 → throw (フォールバックなし)', async () => {
    mockRunGhCommandWithBody.mockRejectedValueOnce(new Error('gh: API error 401'));

    await expect(createIssue('owner/repo', { title: 'Auth flaw' })).rejects.toThrow(
      'gh: API error 401',
    );
    // No retry — no labels present
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
  });
});

// ─── addIssueComment ──────────────────────────────────────────────────────────

describe('addIssueComment', () => {
  beforeEach(resetMocks);

  it('正常系: runGhCommandWithBody を呼び body を返す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');

    const result = await addIssueComment('owner/repo', 42, '改行を含む\nコメント本文');

    expect(result).toEqual({ id: 0, body: '改行を含む\nコメント本文' });
    expect(mockRunGhCommandWithBody).toHaveBeenCalledTimes(1);
    const [args, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string];
    expect(args).toContain('issue');
    expect(args).toContain('comment');
    expect(args).toContain('42');
    expect(args).toContain('--repo');
    expect(args).not.toContain('--body');
    expect(body).toBe('改行を含む\nコメント本文');
  });

  it('日本語長文ボディを runGhCommandWithBody に渡す', async () => {
    mockRunGhCommandWithBody.mockResolvedValueOnce('');
    const longBody = '日本語テキスト'.repeat(200);

    await addIssueComment('owner/repo', 1, longBody);

    const [, body] = mockRunGhCommandWithBody.mock.calls[0] as [string[], string];
    expect(body).toBe(longBody);
  });
});

// ─── ensureLabelsExist (via createIssue) ─────────────────────────────────────

describe('ensureLabelsExist (via createIssue)', () => {
  beforeEach(resetMocks);

  it('already exists エラーは warn を出さない', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('GraphQL: Name has already been taken (createLabel)')) // label create
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL); // issue create

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    // warn should NOT be called for "already" / "taken" errors
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('already exists (already exists) エラーは warn を出さない', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('Label already exists')) // label create
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL); // issue create

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('権限エラーは warn を出す', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('HTTP 403 Forbidden')) // label create fails (auth)
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    mockRunGhCommandWithBody.mockResolvedValueOnce(ISSUE_URL); // issue create

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    expect(mockWarn).toHaveBeenCalledTimes(1);
    const warnCall = mockWarn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ repo: 'owner/repo', label: 'type:bug' });
    expect(warnCall[1]).toContain('Failed to create label');
  });
});
