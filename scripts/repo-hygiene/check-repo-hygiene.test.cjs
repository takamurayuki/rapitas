/**
 * check-repo-hygiene tests (#1403)
 *
 * The two judgements the gate makes: is a root-level file on the allowlist,
 * and does anything other than a script itself (and its test) name it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { unexpectedRootFiles, unreferencedScripts } = require('./check-repo-hygiene.cjs');

test('flags root and package-root files that are not allowlisted, ignores deeper ones', () => {
  const files = [
    'README.md',
    '.wftmp.json',
    'rapitas-backend/package.json',
    'rapitas-backend/result.json',
    'rapitas-backend/services/x.ts',
    'docs/anything.md',
  ];
  const allow = { '': ['README.md'], 'rapitas-backend': ['package.json'] };
  assert.deepEqual(unexpectedRootFiles(files, allow), ['.wftmp.json', 'rapitas-backend/result.json']);
});

test('a script mentioned only by itself or its own test is unreferenced', () => {
  const mentions = {
    'used-tool': ['scripts/used-tool.cjs', 'package.json'],
    'one-shot': ['scripts/one-shot.ts', 'scripts/one-shot.test.ts'],
    'documented': ['scripts/documented.ps1', 'docs/RUNBOOK.md'],
  };
  const grep = (needle) => mentions[needle] || [];
  assert.deepEqual(
    unreferencedScripts(
      ['scripts/used-tool.cjs', 'scripts/one-shot.ts', 'scripts/documented.ps1'],
      grep,
    ),
    ['scripts/one-shot.ts'],
  );
});
