/**
 * alert-backlog-watch tests (#1390)
 *
 * Severity is read the same way across both alert APIs, only alerts past
 * their age limit are reported, and the single tracking issue is opened,
 * updated and closed — never duplicated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { severityOf, overdue, reconcileIssue, TITLE, LABEL } = require('./alert-backlog-watch.cjs');

const NOW = new Date('2026-11-03T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const cs = (number, ruleSeverity, age, securityLevel) => ({
  source: 'code-scanning',
  alert: {
    number,
    created_at: daysAgo(age),
    html_url: `u/${number}`,
    rule: { id: 'js/x', severity: ruleSeverity, security_severity_level: securityLevel },
    most_recent_instance: { location: { path: 'a.ts', start_line: 3 } },
  },
});
const dep = (number, severity, age) => ({
  source: 'dependabot',
  alert: {
    number,
    created_at: daysAgo(age),
    html_url: `d/${number}`,
    security_advisory: { severity, ghsa_id: 'GHSA-x' },
    dependency: { package: { name: 'pkg' }, manifest_path: 'pnpm-lock.yaml' },
  },
});

test('both APIs map onto one severity scale', () => {
  assert.equal(severityOf(cs(1, 'note', 0).alert, 'code-scanning'), 'low');
  assert.equal(severityOf(cs(1, 'warning', 0).alert, 'code-scanning'), 'medium');
  assert.equal(severityOf(cs(1, 'error', 0).alert, 'code-scanning'), 'high');
  // A security rule's own level wins over the generic rule severity.
  assert.equal(severityOf(cs(1, 'warning', 0, 'critical').alert, 'code-scanning'), 'critical');
  assert.equal(severityOf(dep(1, 'moderate', 0).alert, 'dependabot'), 'medium');
});

test('only alerts past their own age limit are reported, oldest first', () => {
  const list = overdue(
    [
      dep(1, 'high', 8), // over 7
      dep(2, 'high', 6), // under 7
      cs(3, 'warning', 31), // over 30
      cs(4, 'note', 59), // under 60
      cs(5, 'note', 240), // the 2026-03 backlog
    ],
    NOW,
  );
  assert.deepEqual(
    list.map((x) => x.number),
    [5, 3, 1],
  );
});

function fakeGh(openIssues) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(openIssues);
    return '';
  };
  return { gh, calls };
}

test('opens one issue when there is a backlog and none is open', () => {
  const f = fakeGh([]);
  const did = reconcileIssue({
    repo: 'o/r',
    list: overdue([dep(1, 'high', 30)], NOW),
    now: NOW,
    gh: f.gh,
  });
  assert.equal(did, 'opened');
  const create = f.calls.find((c) => c[1] === 'create');
  assert.ok(create.includes(TITLE) && create.includes(LABEL));
});

test('updates the open issue instead of opening a second one', () => {
  const f = fakeGh([{ number: 9, title: TITLE }]);
  const did = reconcileIssue({
    repo: 'o/r',
    list: overdue([dep(1, 'high', 30)], NOW),
    now: NOW,
    gh: f.gh,
  });
  assert.equal(did, 'updated');
  assert.ok(f.calls.some((c) => c[1] === 'edit' && c[2] === '9'));
  assert.ok(!f.calls.some((c) => c[1] === 'create'));
});

test('closes the issue once the backlog is clear, and does nothing when already clear', () => {
  const f = fakeGh([{ number: 9, title: TITLE }]);
  assert.equal(reconcileIssue({ repo: 'o/r', list: [], now: NOW, gh: f.gh }), 'closed');
  assert.ok(f.calls.some((c) => c[1] === 'close' && c[2] === '9'));
  const g = fakeGh([]);
  assert.equal(reconcileIssue({ repo: 'o/r', list: [], now: NOW, gh: g.gh }), 'clear');
  assert.equal(g.calls.length, 1);
});
