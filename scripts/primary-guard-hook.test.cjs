'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decision, classify, recordIncident } = require('./primary-guard-hook.cjs');

const PRIMARY = 'C:\\Projects\\rapitas';
const WT = 'C:\\Projects\\rapitas\\.worktrees\\task-907-9f54f7f2';
const ctx = { primaryRoot: PRIMARY, projectDir: WT };
const denied = (command, tool_name = 'Bash') =>
  decision({ tool_name, tool_input: { command } }, ctx)?.hookSpecificOutput?.permissionDecision ===
  'deny';

test('denies the incident command (POSIX-style primary path)', () => {
  assert.equal(
    denied(
      'cd /c/Projects/rapitas && git pull && cd rapitas-backend && RAPITAS_DB_PROVIDER=sqlite DATABASE_URL="file:./rapitas-ci.db" bun run db:prepare:sqlite',
    ),
    true,
  );
});

for (const command of [
  'cd C:\\Projects\\rapitas; git pull',
  'cd C:/Projects/rapitas && git checkout main',
  'cd "/c/Projects/rapitas/rapitas-backend" && bun install',
  'Set-Location C:\\Projects\\rapitas\\rapitas-backend; bun run db:generate',
  'rm -rf /c/Projects/rapitas/node_modules',
  'echo x > C:/Projects/rapitas/a.txt',
  'bunx prisma generate',
  'bunx prisma db push',
  'bun run db:prepare:sqlite',
  'Stop-Process -Name bun -Force',
  'taskkill /F /IM bun.exe',
  'pkill -f bun',
]) {
  test(`denies: ${command}`, () => {
    assert.equal(denied(command), true);
    assert.equal(denied(command, 'PowerShell'), true);
  });
}

for (const command of [
  'git pull',
  'git status --short',
  'bun test --isolate foo.test.ts',
  'cd C:\\Projects\\rapitas\\.worktrees\\task-907-9f54f7f2 && git pull',
  'cd /c/Projects/rapitas/.worktrees/task-907-9f54f7f2/rapitas-backend && bun test a.test.ts',
  'git -C /c/Projects/rapitas log --oneline -5',
  'cat C:/Projects/rapitas/package.json',
  'Get-Process -Name bun',
]) {
  test(`allows: ${command}`, () => {
    assert.equal(decision({ tool_name: 'Bash', tool_input: { command } }, ctx), undefined);
  });
}

test('ignores non-shell tools and non-string commands', () => {
  assert.equal(
    decision({ tool_name: 'Read', tool_input: { command: 'git pull' } }, ctx),
    undefined,
  );
  assert.equal(decision({ tool_name: 'Bash', tool_input: {} }, ctx), undefined);
});

test('prisma / kill rules still apply when the primary root is unknown; path rule fails open', () => {
  const noCtx = { primaryRoot: null, projectDir: '' };
  assert.equal(
    decision({ tool_name: 'Bash', tool_input: { command: 'bunx prisma db push' } }, noCtx)
      .hookSpecificOutput.permissionDecision,
    'deny',
  );
  assert.equal(
    decision(
      { tool_name: 'Bash', tool_input: { command: 'cd /c/Projects/rapitas && git pull' } },
      noCtx,
    ),
    undefined,
  );
});

test('classify reports the incident kind', () => {
  assert.equal(classify('cd /c/Projects/rapitas && git pull', ctx), 'primary_mutation');
  assert.equal(classify('bunx prisma generate', ctx), 'prisma');
  assert.equal(classify('taskkill /F /IM bun.exe', ctx), 'process_kill');
  assert.equal(classify('git status', ctx), null);
});

test('recordIncident appends a redacted, truncated NDJSON line with the task id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  recordIncident(
    {
      kind: 'prisma',
      command: 'DATABASE_URL=secret123 token=abc ' + 'x'.repeat(500),
      projectDir: WT,
    },
    dir,
  );
  const file = fs.readdirSync(dir).find((f) => f.startsWith('guard-incidents-'));
  const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').trim());
  assert.equal(rec.taskId, 907);
  assert.equal(rec.kind, 'prisma');
  assert.ok(rec.command.length <= 200);
  assert.ok(!rec.command.includes('secret123') && !rec.command.includes('abc'));
});

for (const command of [
  'cd /c/Projects/rapitas && sed -i s/a/b/ package.json',
  'cd /c/Projects/rapitas; python fix.py',
  'Set-Location C:\\Projects\\rapitas\\rapitas-backend; python fix.py',
  'pushd C:/Projects/rapitas && node script.js',
]) {
  test(`denies any command after cd into the primary checkout: ${command}`, () => {
    assert.equal(denied(command), true);
    assert.equal(denied(command, 'PowerShell'), true);
  });
}

test('allows cd into a worktree path', () => {
  const command = 'cd /c/Projects/rapitas/.worktrees/task-907-9f54f7f2 && python fix.py';
  assert.equal(decision({ tool_name: 'Bash', tool_input: { command } }, ctx), undefined);
});

test('denies mutating commands when the shell cwd is the primary checkout', () => {
  const primaryCwd = { ...ctx, cwd: 'C:\\Projects\\rapitas\\rapitas-backend' };
  const run = (command, c) => decision({ tool_name: 'Bash', tool_input: { command } }, c);
  assert.equal(run('git pull', primaryCwd)?.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run('git status', primaryCwd), undefined);
  assert.equal(run('git pull', { ...ctx, cwd: WT }), undefined);
});

test('prose in heredoc bodies and commit messages does not trigger prisma/kill rules', () => {
  const run = (command) => decision({ tool_name: 'Bash', tool_input: { command } }, ctx);
  assert.equal(run("cat > notes.md << 'EOF'\nrun prisma generate then taskkill\nEOF"), undefined);
  assert.equal(run('git commit -m "docs: never run prisma generate or taskkill"'), undefined);
  // Code after the heredoc is still checked.
  assert.equal(
    run("cat > n.md << 'EOF'\nnotes\nEOF\nbunx prisma generate").hookSpecificOutput
      .permissionDecision,
    'deny',
  );
});

test('decision() itself is pure: a denial writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  process.env.RAPITAS_GUARD_LOG_DIR = dir;
  decision({ tool_name: 'Bash', tool_input: { command: 'taskkill /F /IM bun.exe' } }, ctx);
  delete process.env.RAPITAS_GUARD_LOG_DIR;
  assert.equal(fs.readdirSync(dir).length, 0);
});
