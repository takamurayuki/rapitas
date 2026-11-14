/**
 * check-docs-style tests
 *
 * Each rule must fail on what it exists to catch (an emoji, a box diagram)
 * and stay quiet on what only looks similar (a directory tree, an arrow in
 * prose, Japanese text, a mermaid block).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { styleViolations, allowMap } = require('./check-docs-style.cjs');

test('emoji: a fixture with an emoji fails, with rule, char and line', () => {
  const md = ['# Title', '', '- ✅ done', 'Plain line'].join('\n');
  assert.deepEqual(styleViolations(md), [{ rule: 'emoji', char: '✅', line: 3 }]);
});

test('emoji: variation-selector symbols and bare check marks count', () => {
  const md = '⚠️ careful\n✓ ok ✗ ng\n🚀 launch';
  assert.deepEqual(
    styleViolations(md).map((v) => v.char),
    ['⚠', '✓', '✗', '🚀'],
  );
});

test('emoji: emoji inside a code fence still fail', () => {
  const md = ['```ts', '// ❌ NEVER', '```'].join('\n');
  assert.equal(styleViolations(md).length, 1);
});

test('emoji: words, Japanese, arrows and GitHub alerts pass', () => {
  const md = [
    '> [!WARNING]',
    '> 悪い例: draft → research_done → completed',
    '| 状態 | 対応済み |',
    '- [x] Good — © 2026, A ↔ B',
  ].join('\n');
  assert.deepEqual(styleViolations(md), []);
});

test('diagram: a box-drawing diagram fails', () => {
  const md = ['```', '┌─────┐', '│ API │', '└──┬──┘', '   ▼', '```'].join('\n');
  const rules = new Set(styleViolations(md).map((v) => v.rule));
  assert.deepEqual([...rules], ['diagram']);
  assert.ok(styleViolations(md).length >= 4);
});

test('diagram: a directory tree and a mermaid block pass', () => {
  const md = [
    '```',
    'routes/',
    '├── index.ts',
    '│   └── a.ts',
    '└── b.ts',
    '```',
    '```mermaid',
    'flowchart LR',
    '  A["フロントエンド (Next.js)"] --> B[Backend]',
    '```',
  ].join('\n');
  assert.deepEqual(styleViolations(md), []);
});

test('allow list: a listed char passes for that doc only, and needs a reason', () => {
  const allow = allowMap([{ file: 'a.md', chars: '✅', reason: 'literal hook output' }]);
  assert.deepEqual(styleViolations('✅ ok', allow.get('a.md')), []);
  assert.equal(styleViolations('✅ ok', allow.get('b.md')).length, 1);
  assert.throws(() => allowMap([{ file: 'a.md', chars: '✅', reason: ' ' }]), /reason/);
});

test('cli: exits non-zero on a repo with an emoji doc, zero once fixed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-style-'));
  const run = () =>
    execFileSync(process.execPath, [path.join(dir, 'scripts/docs/check-docs-style.cjs')], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  fs.mkdirSync(path.join(dir, 'scripts/docs'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'check-docs-style.cjs'),
    path.join(dir, 'scripts/docs/check-docs-style.cjs'),
  );
  fs.writeFileSync(path.join(dir, 'scripts/docs/docs-style-ignore.json'), '{"exceptions":[]}');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Fixture\n\n🎉 Released\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  assert.throws(run, (err) => err.status === 1 && /README\.md:3 emoji/.test(err.stderr));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Fixture\n\nReleased.\n');
  assert.match(run(), /ok/);
  fs.rmSync(dir, { recursive: true, force: true });
});
