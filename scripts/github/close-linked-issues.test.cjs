/**
 * close-linked-issues tests
 *
 * Pins the closing-keyword parser to GitHub's grammar and the close decision to
 * "merged into a non-default branch, names an open issue of this repo".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractClosingRefs, closeLinkedIssues, sweep } = require('./close-linked-issues.cjs');

const REPO = 'takamurayuki/rapitas';

test('every GitHub keyword form closes, case-insensitively, with or without a colon', () => {
  const body = [
    'close #1',
    'closes #2',
    'closed #3',
    'fix #4',
    'fixes #5',
    'fixed #6',
    'resolve #7',
    'resolves #8',
    'resolved #9',
    'CLOSES #10',
    'Fixes: #11',
  ].join('\n');
  assert.deepEqual(extractClosingRefs(body, REPO), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('owner/repo#N and full issue URLs count only for this repository', () => {
  const body = [
    'Closes takamurayuki/rapitas#20',
    'Fixes https://github.com/takamurayuki/rapitas/issues/21',
    'Closes someone/else#22',
    'Fixes https://github.com/someone/else/issues/23',
  ].join('\n');
  assert.deepEqual(extractClosingRefs(body, REPO), [20, 21]);
});

test('Refs / Part of / a bare mention never close', () => {
  const body = 'Refs #30\nPart of #31\nFollow-up to #32\nSee #33\n[#34] in a title\nprefix#35';
  assert.deepEqual(extractClosingRefs(body, REPO), []);
});

test('a keyword glued to a longer word does not count', () => {
  // "prefixes #1" / "unresolved #2" must not read as "fixes" / "resolved".
  assert.deepEqual(extractClosingRefs('prefixes #40\nunresolved #41\nhotfixes #42', REPO), []);
});

test('keywords quoted in code blocks or inline code are ignored', () => {
  const body = [
    'Earlier PRs wrote `Closes #50` for partial work.',
    '```',
    'Closes #51',
    '```',
    '~~~md',
    'Fixes #52',
    '~~~',
    'Closes #53',
  ].join('\n');
  assert.deepEqual(extractClosingRefs(body, REPO), [53]);
});

test('numbers are de-duplicated and do not run into following digits', () => {
  assert.deepEqual(extractClosingRefs('Closes #7. Fixes #7, closes #700', REPO), [7, 700]);
});

/** A fake `gh` that records calls and answers issue lookups from a table. */
function fakeGh(issues) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1].endsWith('/events')) return '[]';
    if (args[0] === 'api') {
      const n = Number(args[1].split('/').pop());
      const i = issues[n];
      if (!i) throw new Error('HTTP 404');
      return JSON.stringify(i);
    }
    return '';
  };
  return {
    gh,
    calls,
    closed: () =>
      calls.filter((c) => c[0] === 'issue' && c[1] === 'close').map((c) => Number(c[2])),
  };
}

const merged = (over = {}) => ({
  number: 900,
  merged: true,
  base: 'develop',
  body: 'Closes #1\nRefs #2',
  ...over,
});

test('a merge into develop closes the open issues it names, with a comment linking the PR', () => {
  const f = fakeGh({ 1: { state: 'open' }, 2: { state: 'open' } });
  const r = closeLinkedIssues({ pr: merged(), repo: REPO, defaultBranch: 'main', gh: f.gh });
  assert.deepEqual(f.closed(), [1]);
  assert.deepEqual(r.closed, [1]);
  const close = f.calls.find((c) => c[1] === 'close');
  assert.equal(close[close.indexOf('--repo') + 1], REPO);
  assert.match(close[close.indexOf('--comment') + 1], /#900/);
  assert.match(close[close.indexOf('--comment') + 1], /Refs #/);
});

test('skips: unmerged PR, merge into the default branch, closed issue, a PR number, a missing number', () => {
  const issues = {
    1: { state: 'closed' },
    2: { state: 'open', pull_request: {} },
    4: { state: 'open' },
  };
  let f = fakeGh(issues);
  closeLinkedIssues({
    pr: merged({ merged: false, body: 'Closes #4' }),
    repo: REPO,
    defaultBranch: 'main',
    gh: f.gh,
  });
  assert.deepEqual(f.calls, [], 'an unmerged PR does nothing');

  f = fakeGh(issues);
  closeLinkedIssues({
    pr: merged({ base: 'main', body: 'Closes #4' }),
    repo: REPO,
    defaultBranch: 'main',
    gh: f.gh,
  });
  assert.deepEqual(f.calls, [], 'GitHub already handles the default branch');

  f = fakeGh(issues);
  const r = closeLinkedIssues({
    pr: merged({ body: 'Closes #1\nCloses #2\nCloses #3\nCloses #4' }),
    repo: REPO,
    defaultBranch: 'main',
    gh: f.gh,
  });
  assert.deepEqual(f.closed(), [4]);
  assert.deepEqual(
    r.skipped.map((s) => s.n),
    [1, 2, 3],
  );
});

test('an issue a person reopened after the PR merged is left open (the sweep must not undo them)', () => {
  const f = fakeGh({ 1: { state: 'open' }, 2: { state: 'open' } });
  const events = {
    1: [
      { event: 'closed', created_at: '2026-11-02T01:00:00Z' },
      { event: 'reopened', created_at: '2026-11-02T02:00:00Z' },
    ],
    2: [{ event: 'reopened', created_at: '2026-10-01T00:00:00Z' }], // reopened BEFORE the merge: still closes
  };
  const gh = (args) => {
    const m = args[0] === 'api' && args[1].match(/issues\/(\d+)\/events$/);
    return m ? JSON.stringify(events[m[1]]) : f.gh(args);
  };
  const pr = merged({ body: 'Closes #1\nCloses #2', mergedAt: '2026-11-02T00:00:00Z' });
  const r = closeLinkedIssues({ pr, repo: REPO, defaultBranch: 'main', gh });
  assert.deepEqual(r.closed, [2]);
  assert.deepEqual(r.skipped, [{ n: 1, why: 'reopened after the PR merged' }]);
});

test('one failing close does not stop the others, and is reported', () => {
  const f = fakeGh({ 1: { state: 'open' }, 2: { state: 'open' } });
  const gh = (args) => {
    if (args[1] === 'close' && args[2] === '1') throw new Error('boom');
    return f.gh(args);
  };
  const r = closeLinkedIssues({
    pr: merged({ body: 'Closes #1\nCloses #2' }),
    repo: REPO,
    defaultBranch: 'main',
    gh,
  });
  assert.deepEqual(r.closed, [2]);
  assert.deepEqual(
    r.failed.map((x) => x.n),
    [1],
  );
});

test('sweep applies the same rule to recently merged PRs on any non-default base', () => {
  const f = fakeGh({ 1: { state: 'open' }, 2: { state: 'open' }, 3: { state: 'open' } });
  const prs = [
    { number: 10, baseRefName: 'develop', body: 'Closes #1', mergedAt: '2026-11-02T00:00:00Z' },
    { number: 11, baseRefName: 'main', body: 'Closes #2', mergedAt: '2026-11-02T00:00:00Z' },
    { number: 12, baseRefName: 'develop', body: 'Refs #3', mergedAt: '2026-11-02T00:00:00Z' },
  ];
  let listArgs = null;
  const gh = (args) => {
    if (args[0] !== 'pr') return f.gh(args);
    listArgs = args;
    return JSON.stringify(prs);
  };
  const r = sweep({
    repo: REPO,
    defaultBranch: 'main',
    days: 14,
    gh,
    now: new Date('2026-11-03T00:00:00Z'),
  });
  assert.deepEqual(f.closed(), [1]);
  assert.deepEqual(r.closed, [1]);
  assert.ok(listArgs.includes('merged:>=2026-10-20'), listArgs.join(' '));
});
