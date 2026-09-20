/**
 * claude-args process guard test
 *
 * Verifies the spawned CLI gets (1) a denylist for backend-killing / prisma commands and
 * (2) an explicitly injected PreToolUse hook (--settings) that rejects primary-checkout
 * commands but allows the same work inside a .worktrees/ checkout (task #996).
 */
import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildClaudeArgs } from './claude-args';
import type { ClaudeCodeAgent } from './agent-core';

const PRIMARY = 'C:\\Projects\\rapitas';
const WORKTREE = 'C:\\Projects\\rapitas\\.worktrees\\task-907-9f54f7f2';

function argsFor(investigationMode: boolean): string[] {
  const agent = {
    logPrefix: '[t]',
    config: { dangerouslySkipPermissions: true, investigationMode },
  } as unknown as ClaudeCodeAgent;
  return buildClaudeArgs(agent).args;
}

function disallowedFor(investigationMode: boolean): string[] {
  const args = argsFor(investigationMode);
  return args[args.indexOf('--disallowedTools') + 1].split(',');
}

/** Resolve the injected hook script and return its decision() function. */
function injectedDecision(): (
  input: unknown,
  ctx: unknown,
) => { hookSpecificOutput: { permissionDecision: string } } | undefined {
  const args = argsFor(false);
  const settingsPath = args[args.indexOf('--settings') + 1];
  expect(existsSync(settingsPath)).toBe(true);
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const entry = settings.hooks.PreToolUse[0];
  expect(entry.matcher).toBe('Bash|PowerShell');
  const command: string = entry.hooks[0].command;
  const script = /node "(.+primary-guard-hook\.cjs)"/.exec(command)?.[1];
  expect(script).toBeTruthy();
  return createRequire(import.meta.url)(script as string).decision;
}

const run =
  (decide: ReturnType<typeof injectedDecision>, cwd = WORKTREE) =>
  (command: string) =>
    decide(
      { tool_name: 'Bash', tool_input: { command } },
      { primaryRoot: PRIMARY, projectDir: WORKTREE, cwd },
    )?.hookSpecificOutput.permissionDecision;

describe('buildClaudeArgs process guard denylist', () => {
  test('denies process-kill commands in both shells', () => {
    const list = disallowedFor(false);
    for (const tool of ['Bash', 'PowerShell']) {
      for (const verb of ['taskkill', 'Stop-Process', 'pkill', 'killall']) {
        expect(list).toContain(`${tool}(${verb}:*)`);
      }
    }
  });

  test('denies prisma and db:* scripts in both shells (works even if the hook does not fire)', () => {
    const list = disallowedFor(false);
    for (const tool of ['Bash', 'PowerShell']) {
      for (const prefix of [
        'bunx prisma',
        'npx prisma',
        'prisma',
        'bun run db:prepare',
        'bun run db:generate',
        'bun run db:push',
      ]) {
        expect(list).toContain(`${tool}(${prefix}:*)`);
      }
    }
  });

  test('keeps existing destructive-git denials', () => {
    expect(disallowedFor(false)).toContain('Bash(git reset --hard:*)');
  });
});

describe('buildClaudeArgs injected PreToolUse hook (--settings)', () => {
  test('injects the guard hook explicitly, independent of project settings', () => {
    const args = argsFor(false);
    expect(args).toContain('--settings');
    injectedDecision();
  });

  test('rejects primary-checkout commands, including cd chaining and relative-path work', () => {
    const decide = run(injectedDecision());
    expect(
      decide(
        'cd /c/Projects/rapitas && git pull && cd rapitas-backend && bun run db:prepare:sqlite',
      ),
    ).toBe('deny');
    expect(decide('cd C:\\Projects\\rapitas; git pull')).toBe('deny');
    expect(decide('cd /c/Projects/rapitas && sed -i s/a/b/ package.json')).toBe('deny');
    expect(decide('cd /c/Projects/rapitas && python fix.py')).toBe('deny');
    expect(decide('bunx prisma generate')).toBe('deny');
    expect(decide('taskkill /F /IM bun.exe')).toBe('deny');
    expect(decide('Stop-Process -Name bun -Force')).toBe('deny');
  });

  test('rejects mutating commands when the shell already sits in the primary checkout', () => {
    const decide = run(injectedDecision(), `${PRIMARY}\\rapitas-backend`);
    expect(decide('git pull')).toBe('deny');
    expect(decide('git status')).toBeUndefined();
  });

  test('.worktrees/ 配下の worktree 内からの同種コマンドは許可される (allows git pull, bun test, cd into the worktree)', () => {
    const decide = run(injectedDecision());
    expect(decide('git pull')).toBeUndefined();
    expect(decide('bun test --isolate foo.test.ts')).toBeUndefined();
    expect(decide(`cd ${WORKTREE} && git pull`)).toBeUndefined();
    expect(decide('cd /c/Projects/rapitas/.worktrees/task-907-9f54f7f2 && python fix.py')).toBe(
      undefined,
    );
    expect(decide('git -C /c/Projects/rapitas log --oneline -3')).toBeUndefined();
  });

  test('investigation mode keeps blocking shell tools outright', () => {
    const list = disallowedFor(true);
    expect(list).toContain('Bash');
    expect(list).toContain('PowerShell');
  });
});

describe('guard settings unavailable (task 1000)', () => {
  test('omits --settings and warns about the project-settings fallback', () => {
    const prev = process.env.RAPITAS_DATA_DIR;
    const scratch = mkdtempSync(join(tmpdir(), 'claude-args-'));
    const blocker = join(scratch, 'not-a-dir');
    writeFileSync(blocker, 'x'); // a file where the data dir should be makes guard creation fail
    process.env.RAPITAS_DATA_DIR = blocker;
    try {
      const agent = {
        logPrefix: '[t]',
        config: { dangerouslySkipPermissions: true, investigationMode: false },
      } as unknown as ClaudeCodeAgent;
      const { args, logExtras } = buildClaudeArgs(agent);
      expect(args).not.toContain('--settings');
      expect(logExtras.some((l) => l.includes('falling back to project settings'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
      else process.env.RAPITAS_DATA_DIR = prev;
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
