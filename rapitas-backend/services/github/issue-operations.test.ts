/**
 * issue-operations.test
 *
 * Tests for createIssue and ensureLabelsExist:
 * - Normal creation with and without labels
 * - Label-less fallback when gh issue create --label fails
 * - ensureLabelsExist warn/silent behavior
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRunGhCommand = mock(() => Promise.resolve(''));
const mockWarn = mock(() => {});
const mockError = mock(() => {});

mock.module('./gh-client', () => ({
  runGhCommand: mockRunGhCommand,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mockWarn,
    error: mockError,
  }),
}));

const { createIssue } = await import('./issue-operations');

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
  mockWarn.mockReset();
  mockError.mockReset();
}

// ─── createIssue ─────────────────────────────────────────────────────────────

describe('createIssue', () => {
  beforeEach(resetMocks);

  it('正常系: ラベルあり → ensureLabels + issue create が呼ばれ Issue を返す', async () => {
    // label create (already exists — ignored), issue create URL, issue view JSON
    mockRunGhCommand
      .mockResolvedValueOnce('') // label create type:security
      .mockResolvedValueOnce('') // label create priority:high
      .mockResolvedValueOnce(ISSUE_URL) // issue create
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    const issue = await createIssue('owner/repo', {
      title: 'Auth flaw',
      body: 'JWT not validated',
      labels: ['type:security', 'priority:high'],
    });

    expect(issue.number).toBe(42);
    expect(issue.labels).toContain('type:security');
    // issue create args should include --label
    const createCall = mockRunGhCommand.mock.calls[2];
    expect(createCall[0]).toContain('--label');
    expect(createCall[0]).toContain('type:security,priority:high');
  });

  it('正常系: ラベルなし → label create をスキップ', async () => {
    mockRunGhCommand
      .mockResolvedValueOnce(ISSUE_URL) // issue create
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    const issue = await createIssue('owner/repo', { title: 'Auth flaw' });

    expect(issue.number).toBe(42);
    // Only 2 calls: create + view (no label calls)
    expect(mockRunGhCommand).toHaveBeenCalledTimes(2);
    const createCall = mockRunGhCommand.mock.calls[0];
    expect(createCall[0]).not.toContain('--label');
  });

  it('フォールバック: ラベル付きが失敗したらラベルなしで再試行して成功', async () => {
    mockRunGhCommand
      .mockResolvedValueOnce('') // label create type:security
      .mockRejectedValueOnce(new Error('Could not resolve to a Label')) // issue create with labels
      .mockResolvedValueOnce(ISSUE_URL) // issue create without labels (fallback)
      .mockResolvedValueOnce(ISSUE_JSON); // issue view

    const issue = await createIssue('owner/repo', {
      title: 'Auth flaw',
      labels: ['type:security'],
    });

    expect(issue.number).toBe(42);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const warnCall = mockWarn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ repo: 'owner/repo', labels: ['type:security'] });
    expect(warnCall[1]).toContain('retrying without labels');
    // 4 total calls: label create, issue create (fail), issue create (no label), issue view
    expect(mockRunGhCommand).toHaveBeenCalledTimes(4);
    // Fallback call should not have --label
    const fallbackCall = mockRunGhCommand.mock.calls[2];
    expect(fallbackCall[0]).not.toContain('--label');
  });

  it('フォールバック後も失敗 → throw', async () => {
    mockRunGhCommand
      .mockResolvedValueOnce('') // label create
      .mockRejectedValueOnce(new Error('Label missing')) // issue create with labels
      .mockRejectedValueOnce(new Error('gh: API error 401')); // fallback also fails

    await expect(
      createIssue('owner/repo', { title: 'Auth flaw', labels: ['type:security'] }),
    ).rejects.toThrow('gh: API error 401');
  });

  it('ラベルなしで失敗 → throw (フォールバックなし)', async () => {
    mockRunGhCommand
      .mockResolvedValueOnce('') // issue create
      .mockRejectedValueOnce(new Error('gh: API error 401')); // issue view

    // createIssue itself doesn't retry when no labels specified — throw propagates
    await expect(createIssue('owner/repo', { title: 'Auth flaw' })).rejects.toThrow();
  });
});

// ─── ensureLabelsExist (via createIssue) ─────────────────────────────────────

describe('ensureLabelsExist (via createIssue)', () => {
  beforeEach(resetMocks);

  it('already exists エラーは warn を出さない', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('GraphQL: Name has already been taken (createLabel)'))
      .mockResolvedValueOnce(ISSUE_URL)
      .mockResolvedValueOnce(ISSUE_JSON);

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    // warn should NOT be called for "already" / "taken" errors
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('already exists (already exists) エラーは warn を出さない', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('Label already exists'))
      .mockResolvedValueOnce(ISSUE_URL)
      .mockResolvedValueOnce(ISSUE_JSON);

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('権限エラーは warn を出す', async () => {
    mockRunGhCommand
      .mockRejectedValueOnce(new Error('HTTP 403 Forbidden')) // label create fails (auth)
      .mockResolvedValueOnce(ISSUE_URL)
      .mockResolvedValueOnce(ISSUE_JSON);

    await createIssue('owner/repo', { title: 'Bug', labels: ['type:bug'] });

    expect(mockWarn).toHaveBeenCalledTimes(1);
    const warnCall = mockWarn.mock.calls[0];
    expect(warnCall[0]).toMatchObject({ repo: 'owner/repo', label: 'type:bug' });
    expect(warnCall[1]).toContain('Failed to create label');
  });
});
