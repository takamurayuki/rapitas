/**
 * claude-execution-runner ユニットテスト
 *
 * buildClaudeArgs / buildSpawnEnv のセキュリティ関連フラグを固定するリグレッションテスト。
 * 将来の変更が --dangerously-skip-permissions の補償コントロール（disallowedTools /
 * 環境サニタイズ）を静かに緩めないようにする。実DB接続なしで動作する（ClaudeCodeAgent の
 * コンストラクタは Prisma へ接続しない — 遅延接続のため import のみでは副作用なし）。
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as priority from '../process-priority';
import * as cli from './cli-utils';
import * as monitor from './idle-monitor';
import { createActivityStore } from '../../workflow/self-verification-activity';
import { orderSelfVerificationResults } from '../../../../rapitas-frontend/src/feature/developer-mode/utils/log-self-verification-order';
import { ClaudeCodeAgent } from './agent-core';
import { buildClaudeArgs, buildSpawnEnv, runClaudeExecution } from './claude-execution-runner';

test('Workerの完了通知前に自己検証を同期し、次の監視周期まで完了表示を漏らさない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-result-order-'));
  const previous = process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR;
  process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR = dir;
  const store = createActivityStore({ dir });
  const ref = { runId: 'early', taskId: 1582, worktreePath: 'C:/work' };
  const stream = () => Object.assign(new EventEmitter(), { setEncoding() {} });
  const child = Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream() });
  const spawn = spyOn(priority, 'spawnLowPriority').mockReturnValue(
    child as unknown as ChildProcess,
  );
  const path = spyOn(cli, 'getClaudePath').mockResolvedValue('claude');
  const idle = spyOn(monitor, 'startIdleMonitor').mockReturnValue({
    cleanup() {},
    recordOutput() {},
    markReceivedOutput() {},
  } as ReturnType<typeof monitor.startIdleMonitor>);
  const OriginalWorker = globalThis.Worker;
  class FakeWorker {
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const agent = new ClaudeCodeAgent('early', 'test', { resumeSessionId: 'session' });
  const output: string[] = [];
  const emit = spyOn(agent, 'emitOutputInternal').mockImplementation((line) => {
    output.push(line);
  });
  try {
    await runClaudeExecution(
      agent,
      { id: 1582, title: 'test' },
      ref.worktreePath,
      Date.now(),
      900000,
      () => {},
      () => () => {},
    );
    expect(agent.parserWorker).not.toBeNull();
    store.markStarted(ref);
    const deliver = () =>
      agent.parserWorker!.onmessage!({
        data: {
          type: 'result-event',
          displayOutput: '\n[Result: success (0.1s)]\n',
          result: '待機中',
        },
      } as MessageEvent);
    deliver();
    const visible = () => orderSelfVerificationResults(output.join('').split('\n'));
    expect(visible().some((line) => line.startsWith('[Result:'))).toBe(false);
    expect(visible()).toContain('[SelfVerification] waiting runId=early');
    store.markFinished({ ...ref, ok: true, unverifiable: false, passed: 4, failed: 0 });
    deliver();
    const lines = visible();
    const verdict = lines.findIndex((line) => line.startsWith('[SelfVerification] result'));
    expect(lines[verdict]).toContain('ok=true unverifiable=false passed=4 failed=0');
    expect(lines.findIndex((line) => line.startsWith('[Result:'))).toBeGreaterThan(verdict);
    expect(agent.outputBuffer).not.toContain('[SelfVerification]');
  } finally {
    agent.setStatusInternal('cancelled');
    child.emit('close', 0);
    spawn.mockRestore();
    path.mockRestore();
    idle.mockRestore();
    emit.mockRestore();
    globalThis.Worker = OriginalWorker;
    if (previous === undefined) delete process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR;
    else process.env.RAPITAS_SELF_VERIFY_ACTIVE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildClaudeArgs', () => {
  test('verifier can execute checks and save evidence while recursive tools remain denied', () => {
    const agent = new ClaudeCodeAgent('verifier', 'verifier', {
      investigationMode: false,
      investigationOutputType: 'verify',
    });
    const { args } = buildClaudeArgs(agent);
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    expect(denied).not.toContain('Bash');
    expect(denied).toContain('Task');
    expect(denied).toContain('EnterWorktree');
    expect(args).toContain('--strict-mcp-config');
  });
  test('dangerouslySkipPermissions=true のとき bypass 系フラグが両方付与される', () => {
    const agent = new ClaudeCodeAgent('t1', 'test-agent', {
      dangerouslySkipPermissions: true,
    });

    const { args } = buildClaudeArgs(agent);

    expect(args).toContain('--dangerously-skip-permissions');
    const modeIdx = args.indexOf('--permission-mode');
    expect(modeIdx).toBeGreaterThanOrEqual(0);
    expect(args[modeIdx + 1]).toBe('bypassPermissions');
  });

  test('dangerouslySkipPermissions=false のとき bypass 系フラグは付与されない', () => {
    const agent = new ClaudeCodeAgent('t2', 'test-agent', {
      dangerouslySkipPermissions: false,
    });

    const { args } = buildClaudeArgs(agent);

    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--permission-mode');
  });

  test('通常モード（investigationMode=false）: ネットワーク越境/再帰系ツールが disallowedTools に含まれる', () => {
    const agent = new ClaudeCodeAgent('t3', 'test-agent', {
      dangerouslySkipPermissions: true,
      investigationMode: false,
    });

    const { args } = buildClaudeArgs(agent);
    const idx = args.indexOf('--disallowedTools');
    expect(idx).toBeGreaterThanOrEqual(0);
    const disallowed = args[idx + 1].split(',');

    // NOTE: implementer/verifier に不要なツール群 — 緩めた変更を検知するための固定リスト
    for (const tool of [
      'EnterWorktree',
      'ExitWorktree',
      'WebFetch',
      'WebSearch',
      'ToolSearch',
      'Skill',
      'Task',
    ]) {
      expect(disallowed).toContain(tool);
    }
    // 通常モードでは Bash/Edit/Write は許可されたまま（実装作業に必須）
    expect(disallowed).not.toContain('Bash');
    expect(disallowed).not.toContain('Edit');
    expect(disallowed).not.toContain('Write');
  });

  test('investigationMode=true: 上記に加え Bash/Edit/Write/PowerShell/NotebookEdit も禁止される', () => {
    const agent = new ClaudeCodeAgent('t4', 'test-agent', {
      dangerouslySkipPermissions: true,
      investigationMode: true,
    });

    const { args } = buildClaudeArgs(agent);
    const idx = args.indexOf('--disallowedTools');
    const disallowed = args[idx + 1].split(',');

    for (const tool of [
      'EnterWorktree',
      'ExitWorktree',
      'WebFetch',
      'WebSearch',
      'ToolSearch',
      'Skill',
      'Task',
      'Bash',
      'PowerShell',
      'Edit',
      'Write',
      'NotebookEdit',
    ]) {
      expect(disallowed).toContain(tool);
    }
  });

  test('--strict-mcp-config は常に付与される（機械全体のMCPサーバーをアンビエントに読み込ませない）', () => {
    const agent = new ClaudeCodeAgent('t5', 'test-agent', {});
    const { args } = buildClaudeArgs(agent);
    expect(args).toContain('--strict-mcp-config');
    // --mcp-config は渡さない設計 — strict と組み合わせて初めて「MCPサーバーを一切読み込まない」になる
    expect(args).not.toContain('--mcp-config');
  });
});

describe('buildSpawnEnv', () => {
  test('secrets が process.env にあってもサニタイズされ、CLI用オーバーライドは維持される', () => {
    const originalEncryptionKey = process.env.ENCRYPTION_KEY;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalGithubToken = process.env.GITHUB_TOKEN;

    process.env.ENCRYPTION_KEY = 'super-secret-key';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.GITHUB_TOKEN = 'ghp_dummy';

    try {
      const env = buildSpawnEnv();

      expect(env.ENCRYPTION_KEY).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();

      // CLI-friendly overrides applied by this function
      expect(env.FORCE_COLOR).toBe('0');
      expect(env.NO_COLOR).toBe('1');
      expect(env.CI).toBe('1');
    } finally {
      // restore so this test doesn't leak env state into other test files
      if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = originalEncryptionKey;
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });
});

describe('autonomous reasoning effort', () => {
  test.each([undefined, 'invalid', 'high', ' medium '])(
    'bounds effort and records the selected value',
    (configured) => {
      const previous = process.env.RAPITAS_CLAUDE_EFFORT;
      try {
        if (configured === undefined) delete process.env.RAPITAS_CLAUDE_EFFORT;
        else process.env.RAPITAS_CLAUDE_EFFORT = configured;
        const agent = new ClaudeCodeAgent('effort', 'test-agent', {});
        const { args, logExtras } = buildClaudeArgs(agent);
        const expected = configured === 'high' ? 'high' : 'medium';
        expect(args[args.indexOf('--effort') + 1]).toBe(expected);
        expect(logExtras.some((line) => line.endsWith('Effort: ' + expected))).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.RAPITAS_CLAUDE_EFFORT;
        else process.env.RAPITAS_CLAUDE_EFFORT = previous;
      }
    },
  );
});

// Task 1582: an agent that started a background waiter (Monitor) and ended its
// turn was treated as finished — under `--print` the notification never comes.
describe('background waiting tools are forbidden (task 1582)', () => {
  test.each([false, true])(
    'Monitor / ScheduleWakeup / CronCreate are in --disallowedTools (investigationMode=%p)',
    (investigationMode) => {
      const agent = new ClaudeCodeAgent('bg', 'test-agent', { investigationMode });
      const { args } = buildClaudeArgs(agent);
      const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
      for (const tool of ['Monitor', 'ScheduleWakeup', 'CronCreate']) {
        expect(denied).toContain(tool);
      }
    },
  );

  test('Bash run_in_background is disabled through CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1', () => {
    // run_in_background is a Bash argument, not a tool name, so --disallowedTools cannot name it.
    expect(buildSpawnEnv().CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
  });

  test('the inherited environment cannot switch background tasks back on', () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;
    try {
      process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '0';
      expect(buildSpawnEnv().CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;
      else process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = prev;
    }
  });
});
