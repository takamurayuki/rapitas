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

test('process-kill words inside quoted data arguments are allowed', () => {
  const incident =
    'printf \'%s\' \'{"tool_name":"Bash","tool_input":{"command":"grep -n \\"process_kill\\\\|taskkill\\\\|Stop-Process\\\\|pkill\\" a.test.ts';
  assert.equal(classify('grep -n "process_kill\\|taskkill\\|Stop-Process\\|pkill" a.test.ts', ctx), null);
  assert.equal(classify("rg 'pkill' src", ctx), null);
  assert.equal(classify(`printf '%s' '{"c":"taskkill"}'`, ctx), null);
  assert.equal(classify(incident + "'", ctx), null);
});

test('real process kills stay denied despite quoting tricks', () => {
  for (const cmd of [
    'taskkill /F /IM bun.exe',
    'grep x f && pkill bun',
    'echo "x"; taskkill /F /PID 1',
    'bash -c "taskkill /F /IM bun.exe"',
    'powershell -Command "Stop-Process -Name bun"',
    '"taskkill" /F /IM bun.exe',
    "echo hi | 'pkill' bun",
    'grep "a" f; Stop-Process -Id 3',
    'echo "$(taskkill /F /IM bun.exe)"',
    'echo "unterminated taskkill',
  ]) {
    assert.equal(classify(cmd, ctx), 'process_kill', cmd);
  }
});

test('search verbs may name kill words in quoted terms; real kills still deny', () => {
  const allow = [
    'grep -n "process_kill\\|taskkill\\|Stop-Process\\|pkill" rapitas-backend/a.test.ts | head -12',
    "rg 'Stop-Process' .",
    'Select-String -Pattern "taskkill" -Path a.ts',
  ];
  for (const c of allow) assert.equal(classify(c, ctx), null, c);
  const deny = [
    'grep x f; pkill bun',
    'grep x f && Stop-Process -Name bun',
    'grep x f | xargs taskkill /F',
    'grep "$(pkill bun)" f',
    'grep "`pkill bun`" f',
    'sh -c "pkill bun"',
    'grep "unterminated pkill',
    "rg --pre 'pkill bun' x .",
    'rg --pre "taskkill /F /IM bun.exe" x .',
    'rg x --hostname-bin="pkill bun" .',
    'grep "x" $(pkill bun)',
    'grep -e x -f <(pkill bun)',
  ];
  for (const c of deny) assert.equal(classify(c, ctx), 'process_kill', c);
});

test('rg --pre / --hostname-bin execute their argument, so quoted kill words there stay denied', () => {
  for (const c of [
    "rg --pre 'pkill bun' x .",
    'rg --pre "taskkill /F /IM bun.exe" x .',
    'rg x --hostname-bin="pkill bun" .',
    "rg --pre='Stop-Process -Name bun' x .",
  ]) {
    assert.equal(classify(c, ctx), 'process_kill', c);
  }
  // Plain searches naming the same words (and a lookalike flag) remain allowed.
  assert.equal(classify("rg 'pkill' src", ctx), null);
  assert.equal(classify("rg --pretty 'pkill' src", ctx), null);
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

test('backslash-escaped and unquoted heredocs: prose allowed, expansions still checked', () => {
  const run = (command) => decision({ tool_name: 'Bash', tool_input: { command } }, ctx);
  const isDeny = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';
  // The reported incident shape: worktree cd + verify report written via heredoc.
  assert.equal(
    run(
      "cd /c/Projects/rapitas/.worktrees/task-996-99e592e1 && cat > .wf-x.md <<'EOF'\n# 検証レポート\nprisma generate は禁止\nEOF",
    ),
    undefined,
  );
  // <<\EOF is quoted for the shell: no expansion, so the body is inert.
  assert.equal(run('cat > n.md <<\\EOF\nrun prisma generate or taskkill\nEOF'), undefined);
  // Unquoted <<EOF: plain prose is inert...
  assert.equal(run('cat > n.md <<EOF\nrun prisma generate or taskkill\nEOF'), undefined);
  // ...but $(...) and backticks in the body are executed by the shell.
  assert.equal(isDeny(run('cat > n.md <<EOF\nx $(bunx prisma generate) y\nEOF')), true);
  assert.equal(isDeny(run('cat > n.md <<EOF\nx `taskkill /F /IM bun.exe` y\nEOF')), true);
  // Code after an unquoted heredoc is still checked.
  assert.equal(isDeny(run('cat <<EOF\nnotes\nEOF\nbunx prisma generate')), true);
});

test('heredoc edge cases cannot be used to hide executed code', () => {
  const run = (command) => decision({ tool_name: 'Bash', tool_input: { command } }, ctx);
  const isDeny = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';
  // Multi-line and nested command substitutions in an expanding heredoc body.
  assert.equal(isDeny(run('cat <<EOF\nx $(\n  bunx prisma generate\n)\nEOF')), true);
  assert.equal(isDeny(run('cat <<EOF\nx $(echo $(bunx prisma generate))\nEOF')), true);
  assert.equal(isDeny(run('cat <<EOF\nx `\ntaskkill /F /IM bun.exe\n`\nEOF')), true);
  // An escaped `\$(` is literal text for the shell, so it stays prose.
  assert.equal(run('cat <<EOF\nnever run \\$(bunx prisma generate)\nEOF'), undefined);
  // Here-strings and arithmetic shifts are not heredocs: the following code is still checked.
  assert.equal(isDeny(run('cat <<< foo\nbunx prisma generate')), true);
  assert.equal(isDeny(run('echo $((1<<EOF))\nbunx prisma generate')), true);
  // An unterminated heredoc never swallows the remaining commands.
  assert.equal(isDeny(run("cat <<'EOF'\nnotes\nbunx prisma generate")), true);
  // Several heredocs on one line: each body is consumed in order.
  assert.equal(run("cat <<'A' <<'B'\nprisma generate\nA\ntaskkill\nB"), undefined);
  assert.equal(isDeny(run("cat <<'A' <<'B'\nx\nA\ny\nB\nbunx prisma generate")), true);
});

test('a denial carries a deny payload with the incident kind and reason', () => {
  const r = decision(
    { tool_name: 'Bash', tool_input: { command: 'cat <<EOF\n$(bunx prisma generate)\nEOF' } },
    ctx,
  );
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(r._kind, 'prisma');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /prisma/);
});

test('decision() itself is pure: a denial writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  process.env.RAPITAS_GUARD_LOG_DIR = dir;
  decision({ tool_name: 'Bash', tool_input: { command: 'taskkill /F /IM bun.exe' } }, ctx);
  delete process.env.RAPITAS_GUARD_LOG_DIR;
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('search-tool exec options (--pre / --hostname-bin) deny quoted kill words, plain searches stay allowed', () => {
  for (const c of [
    "rg --pre 'pkill bun' x .",
    'rg x . --pre "killall bun"',
    "rg --pre='taskkill /F /IM bun.exe' x .",
    "rg x --hostname-bin 'Stop-Process -Name bun' .",
  ]) {
    assert.equal(classify(c, ctx), 'process_kill', c);
  }
  assert.equal(classify("rg 'pkill' --glob '*.ts' .", ctx), null);
});

test('exec-option denial is scoped to the option argument; other exec paths and plain pkill still deny', () => {
  assert.equal(classify("rg --pre cat 'pkill' .", ctx), null);
  assert.equal(classify("rg --pre cat 'taskkill' --glob '*.ts' .", ctx), null);
  for (const c of [
    'pkill bun',
    'pkill -f bun',
    'find . -name x -exec pkill bun \;',
    'ls | xargs pkill',
    'rg --pre pkill x .',
    'rg --pre "sh -c \'pkill bun\'" x .',
  ]) {
    assert.equal(classify(c, ctx), 'process_kill', c);
  }
});

// 2026-09-24, task 1055: a `pnpm install` run inside a worktree re-pointed 60
// primary rapitas-frontend/node_modules symlinks at the worktree path.
for (const command of [
  'pnpm install --no-frozen-lockfile',
  'cd rapitas-frontend && pnpm install',
  'npm i cross-env',
  'bun add -d vitest',
  'yarn add lodash',
  'pnpm -C rapitas-frontend install --frozen-lockfile',
  'npm ci',
  'pnpm up',
]) {
  test(`denies package install in a worktree: ${command}`, () => {
    const d = decision({ tool_name: 'Bash', tool_input: { command }, cwd: WT }, { ...ctx, cwd: WT });
    assert.equal(d?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal(d?._kind, 'package_install');
  });
}

for (const command of [
  'pnpm test',
  'bun test services/x.test.ts',
  'npm run dev:runtime -- -p 3005',
  'bunx tsc --noEmit',
  'grep -rn "pnpm install" docs/',
  'git commit -m "docs: explain why npm install is forbidden"',
  'bun run db:import',
  // 2026-09-25, task 1086: `bun pm cache` only clears bun's global download
  // cache, not the shared node_modules tree, so it must not be classified
  // as package_install even though bare `rm` is in the verb list.
  'bun pm cache rm',
  'bun pm cache',
]) {
  test(`still allows non-install package commands: ${command}`, () => {
    assert.equal(denied(command), false);
  });
}

test('allows the reported task-911 incident command verbatim inside a worktree', () => {
  const command =
    'cd "C:/Projects/rapitas/.worktrees/task-911-5569f5fa/rapitas-backend" && bun pm cache rm';
  assert.equal(classify(command, { ...ctx, cwd: WT }), null);
});

// Read-only inspection after entering primary: still denied, but classified
// apart so the incident filer does not raise a security task for it.
for (const command of [
  'cd /c/Projects/rapitas && git worktree list | head -5',
  'cd "C:\\Projects\\rapitas" && git status --porcelain --untracked-files=no',
  'cd C:/Projects/rapitas; git log --oneline -5 -- rapitas-backend',
  'Set-Location C:\\Projects\\rapitas; Get-Content package.json',
  'cd /c/Projects/rapitas && cd rapitas-backend && git branch --show-current',
  'cd /c/Projects/rapitas && find . -name "*.md" -maxdepth 1',
]) {
  test(`denies read-only inspection after cd into primary as primary_readonly: ${command}`, () => {
    assert.equal(classify(command, { primaryRoot: PRIMARY }), 'primary_readonly');
    assert.equal(denied(command), true);
    assert.equal(denied(command, 'PowerShell'), true);
  });
}

for (const command of [
  'cd /c/Projects/rapitas && git status && git pull',
  'cd /c/Projects/rapitas && cat a.txt > b.txt',
  'cd /c/Projects/rapitas && find . -name "*.log" -delete',
  'cd /c/Projects/rapitas && git branch feature/x',
  'cd /c/Projects/rapitas && git diff --output=patch.diff',
  'cd /c/Projects/rapitas && ls | xargs rm',
  'cd /c/Projects/rapitas && python fix.py',
  'cd /c/Projects/rapitas && cat $(ls)',
  'cd /c/Projects/rapitas && tee out.txt',
]) {
  test(`anything that can write after cd into primary stays primary_mutation: ${command}`, () => {
    assert.equal(classify(command, { primaryRoot: PRIMARY }), 'primary_mutation');
    assert.equal(denied(command), true);
  });
}

test('primary_readonly denial carries its own guidance', () => {
  const r = decision(
    { tool_name: 'Bash', tool_input: { command: 'cd /c/Projects/rapitas && git status' } },
    ctx,
  );
  assert.equal(r._kind, 'primary_readonly');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /git -C/);
});
