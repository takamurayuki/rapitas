/**
 * check-docs-drift tests (#1403)
 *
 * Each check must catch the drift it was built for — the cases are the real
 * ones found on 2026-11-03 — without flagging what only looks like a path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pathTokens,
  resolves,
  missingScripts,
  versionMismatches,
  statusDrift,
  envReads,
} = require('./check-docs-drift.cjs');

const tracked = (paths) => {
  const all = new Set(paths);
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return { all, list: [...all] };
};

test('path tokens: backticks and links outside fences, minus URLs, placeholders and classes', () => {
  const md = [
    'See `rapitas-backend/index.ts` and [setup](docs/SETUP.md#node).',
    '```',
    '`inside/a/fence.ts`',
    '```',
    '`https://example.com/x.ts` `schema/<name>.prisma` `bg-indigo-500/600` `.tsx` `next/font`',
    'A dir: `rapitas-desktop/src-tauri/`',
  ].join('\n');
  assert.deepEqual(
    pathTokens(md).map((t) => t.token),
    ['rapitas-backend/index.ts', 'docs/SETUP.md', 'rapitas-desktop/src-tauri/'],
  );
});

test('a moved file no longer resolves; a shortened tail of a real path does', () => {
  const t = tracked([
    'rapitas-backend/services/agents/orchestrator/git-operations/worktree/worktree-ops.ts',
    'rapitas-frontend/src/components/ui/status-card/StatusCard.tsx',
  ]);
  const doc = 'docs/deep-dive/safe-agent-execution.md';
  assert.equal(
    resolves('services/agents/orchestrator/git-operations/worktree-ops.ts', doc, t),
    false,
  );
  assert.equal(resolves('ui/status-card/StatusCard.tsx', doc, t), true);
  assert.equal(resolves('worktree-ops.ts', doc, t), true);
  assert.equal(resolves('index-optimized.ts', doc, t), false);
});

test('scripts: `run <name>` must exist; `run <file>` is not a script', () => {
  const md = 'bun run dev\nbun run logs\nbun run scripts/x.ts\nnpm run build:all';
  assert.deepEqual(
    missingScripts(md, new Set(['dev', 'build:all'])).map((m) => m.name),
    ['logs'],
  );
});

test('versions: stale Node / Bun / pnpm pins are reported', () => {
  const md = 'Node.js 20.x\nBun 1.3.11\npnpm 10.34.9\nNode 24';
  const pins = { node: '24', bun: '1.3.13', pnpm: '10.34.9' };
  assert.deepEqual(
    versionMismatches(md, pins).map((v) => `${v.tool}:${v.stated}`),
    ['node:20', 'bun:1.3.11'],
  );
});

test('statuses: the 2026-11 CLAUDE.md chain is caught, and a made-up status too', () => {
  const statuses = ['draft', 'research_done', 'plan_created', 'verify_done', 'completed'];
  const old = 'draft → research_done → plan_created → completed';
  assert.deepEqual(statusDrift(old, statuses), { unknown: [], missing: ['verify_done'] });
  const bogus = 'draft → research_done → plan_created → verify_done → shipped_out → completed';
  assert.deepEqual(statusDrift(bogus, statuses).unknown, ['shipped_out']);
});

test('env reads: dot and bracket access, not lowercase or computed names', () => {
  const src =
    "process.env.RAPITAS_X; Bun.env.PORT; process.env['DATABASE_URL']; process.env[name]; process.env.lower";
  assert.deepEqual(envReads(src).sort(), ['DATABASE_URL', 'PORT', 'RAPITAS_X']);
});
