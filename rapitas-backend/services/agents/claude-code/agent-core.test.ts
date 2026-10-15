/**
 * agent-core ユニットテスト（コア部分）
 *
 * コンストラクタのデフォルト設定、getCapabilities、resumeSessionId/continueConversation
 * ゲッター、BaseAgent プロキシメソッド（emitOutputInternal 等）、Worker メッセージ委譲、
 * isAvailable/validateConfig を対象とする。execute() 本体と停止系ライフサイクルは
 * agent-core.execute.test.ts / agent-core.lifecycle.test.ts に分割。
 *
 * 実 CLI プロセスは一切 spawn しない — ./cli-utils と ./claude-execution-runner は
 * 完全にモックし、実体の spawn/Worker 生成コードパスへ到達させない。
 */
import { describe, expect, mock, test } from 'bun:test';
import type { WorkerOutputMessage } from '../../../workers/output-parser-types';
import {
  createPrismaMock,
  databaseModuleFactory,
  prismaModelMock,
} from '../../../tests/helpers/mock-database';

// --- モックセットアップ（動的 import より先に定義すること） ---

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getBackendLogFilePath: () => '/tmp/backend-test.log',
}));

const mockPrisma = createPrismaMock({ task: prismaModelMock() });
mock.module('../../../config/database', () => databaseModuleFactory(mockPrisma));

// checkClaudeAvailable を差し替え可能なクロージャ経由で提供する（実CLIは呼ばない）
let mockClaudeAvailable = true;
mock.module('./cli-utils', () => ({
  resolveCliPath: (name: string) => name,
  getClaudePath: () => 'claude.cmd',
  checkClaudeAvailable: () => Promise.resolve(mockClaudeAvailable),
  buildSpawnCommand: (path: string, args: string[]) => [path, args] as [string, string[]],
}));

// runClaudeExecution は execute() のオーケストレーション専用テスト（execute.test.ts）でのみ
// 呼び出しを検証する。ここでは import 解決のためだけにダミーを提供する。
mock.module('./claude-execution-runner', () => ({
  buildClaudeArgs: () => ({ args: [], logExtras: [] }),
  buildSpawnEnv: () => ({}),
  runClaudeExecution: mock(() => {}),
}));

// worker-message-handler / execution-resolver の唯一のランタイム export をスパイ化
const handleWorkerMessageSpy = mock(() => {});
mock.module('./worker-message-handler', () => ({
  handleWorkerMessage: handleWorkerMessageSpy,
}));

mock.module('./execution-resolver', () => ({
  buildResolveAfterParse: mock(() => () => {}),
}));

// モック確定後に動的 import
const { ClaudeCodeAgent } = await import('./agent-core');
const { getAgentTimeoutMs } = await import('../execution-timeouts');

// --- テストスイート ---

describe('ClaudeCodeAgent — コンストラクタ / config デフォルト', () => {
  test('timeout 未指定時は getAgentTimeoutMs() の値がデフォルトになる', () => {
    const agent = new ClaudeCodeAgent('t1', 'agent-1');
    expect(agent.config.timeout).toBe(getAgentTimeoutMs());
  });

  test('config.timeout を明示指定した場合はそちらが優先される', () => {
    const agent = new ClaudeCodeAgent('t2', 'agent-2', { timeout: 12345 });
    expect(agent.config.timeout).toBe(12345);
  });

  test('id / name / type が BaseAgent へ正しく渡される', () => {
    const agent = new ClaudeCodeAgent('t3', 'agent-3');
    expect(agent.id).toBe('t3');
    expect(agent.name).toBe('agent-3');
    expect(agent.type).toBe('claude-code');
    expect(agent.logPrefix).toBe('[agent-3]');
  });

  test('初期状態フィールドが期待する初期値を持つ', () => {
    const agent = new ClaudeCodeAgent('t4', 'agent-4');
    expect(agent.process).toBeNull();
    expect(agent.outputBuffer).toBe('');
    expect(agent.finalResultText).toBe('');
    expect(agent.errorBuffer).toBe('');
    expect(agent.lineBuffer).toBe('');
    expect(agent.claudeSessionId).toBeNull();
    expect(agent.hasFileModifyingToolCalls).toBe(false);
    expect(agent.idleTimeoutForceKilled).toBe(false);
    expect(agent.parserWorker).toBeNull();
    expect(agent.workerArtifacts).toEqual([]);
    expect(agent.workerCommits).toEqual([]);
    expect(agent.workerResultUsage).toBeNull();
    expect(agent.onParseComplete).toBeNull();
    expect(agent.activeTools.size).toBe(0);
    expect(agent.getStatus()).toBe('idle');
  });
});

describe('ClaudeCodeAgent — resumeSessionId / continueConversation ゲッター', () => {
  test('config.resumeSessionId をそのまま返す', () => {
    const agent = new ClaudeCodeAgent('t5', 'agent-5', { resumeSessionId: 'sess-abc' });
    expect(agent.resumeSessionId).toBe('sess-abc');
  });

  test('未設定時は undefined', () => {
    const agent = new ClaudeCodeAgent('t6', 'agent-6');
    expect(agent.resumeSessionId).toBeUndefined();
  });

  test('config.continueConversation をそのまま返す', () => {
    const agent = new ClaudeCodeAgent('t7', 'agent-7', { continueConversation: true });
    expect(agent.continueConversation).toBe(true);
  });
});

describe('ClaudeCodeAgent — getCapabilities', () => {
  test('claude-code エージェントの能力宣言が仕様どおり', () => {
    const agent = new ClaudeCodeAgent('t8', 'agent-8');
    expect(agent.getCapabilities()).toEqual({
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: true,
      terminalAccess: true,
      gitOperations: true,
      webSearch: true,
    });
  });
});

describe('ClaudeCodeAgent — BaseAgent プロキシメソッド', () => {
  test('emitOutputInternal は setOutputHandler で登録したハンドラを呼ぶ', () => {
    const agent = new ClaudeCodeAgent('t9', 'agent-9');
    const handler = mock(() => {});
    agent.setOutputHandler(handler);

    agent.emitOutputInternal('hello', true);

    expect(handler).toHaveBeenCalledWith('hello', true);
  });

  test('emitOutputInternal のデフォルト isError は false', () => {
    const agent = new ClaudeCodeAgent('t10', 'agent-10');
    const handler = mock(() => {});
    agent.setOutputHandler(handler);

    agent.emitOutputInternal('plain output');

    expect(handler).toHaveBeenCalledWith('plain output', false);
  });

  test('emitQuestionDetectedInternal は setQuestionDetectedHandler で登録したハンドラを呼ぶ', () => {
    const agent = new ClaudeCodeAgent('t11', 'agent-11');
    const handler = mock(() => {});
    agent.setQuestionDetectedHandler(handler);

    const info = { question: 'どちらにしますか？', questionType: 'tool_call' as const };
    agent.emitQuestionDetectedInternal(info);

    expect(handler).toHaveBeenCalledWith(info);
  });

  test('setStatusInternal は status を書き換え、getStatus に反映される', () => {
    const agent = new ClaudeCodeAgent('t12', 'agent-12');
    agent.setStatusInternal('waiting_for_input');
    expect(agent.getStatus()).toBe('waiting_for_input');
  });
});

describe('ClaudeCodeAgent — handleWorkerMessageInternal', () => {
  test('Worker メッセージをハンドラ関数へそのまま委譲する（コンテキストは agent 自身）', () => {
    handleWorkerMessageSpy.mockClear();
    const agent = new ClaudeCodeAgent('t13', 'agent-13');
    const msg: WorkerOutputMessage = { type: 'raw-output', displayOutput: 'chunk' };

    agent.handleWorkerMessageInternal(msg);

    expect(handleWorkerMessageSpy).toHaveBeenCalledTimes(1);
    const [ctxArg, msgArg] = handleWorkerMessageSpy.mock.calls[0] as [unknown, WorkerOutputMessage];
    expect(ctxArg).toBe(agent);
    expect(msgArg).toBe(msg);
  });
});

describe('ClaudeCodeAgent — isAvailable', () => {
  test('CLI が利用可能な場合 true を返す', async () => {
    mockClaudeAvailable = true;
    const agent = new ClaudeCodeAgent('t14', 'agent-14');
    expect(await agent.isAvailable()).toBe(true);
  });

  test('CLI が利用不可の場合 false を返す', async () => {
    mockClaudeAvailable = false;
    const agent = new ClaudeCodeAgent('t15', 'agent-15');
    expect(await agent.isAvailable()).toBe(false);
    mockClaudeAvailable = true; // 他テストへ影響しないよう復元
  });
});

describe('ClaudeCodeAgent — validateConfig', () => {
  test('CLI 利用可能 + workingDirectory 未指定 → valid: true, errors 空', async () => {
    mockClaudeAvailable = true;
    const agent = new ClaudeCodeAgent('t16', 'agent-16');
    const result = await agent.validateConfig();
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('CLI 利用不可 → errors に CLI 未インストールメッセージが入る', async () => {
    mockClaudeAvailable = false;
    const agent = new ClaudeCodeAgent('t17', 'agent-17');
    const result = await agent.validateConfig();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Claude Code CLI is not installed or not available in PATH');
    mockClaudeAvailable = true;
  });

  test('workingDirectory が存在しないディレクトリ → errors にパスを含むメッセージが入る', async () => {
    mockClaudeAvailable = true;
    const agent = new ClaudeCodeAgent('t18', 'agent-18', {
      workingDirectory: 'Z:/definitely/not/a/real/path/xyz',
    });
    const result = await agent.validateConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  test('workingDirectory がファイル（ディレクトリではない）→ errors に非ディレクトリメッセージが入る', async () => {
    mockClaudeAvailable = true;
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const filePath = path.join(os.tmpdir(), `agent-core-validate-config-${Date.now()}.txt`);
    fs.writeFileSync(filePath, 'not a directory');
    try {
      const agent = new ClaudeCodeAgent('t19', 'agent-19', { workingDirectory: filePath });
      const result = await agent.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('is not a directory'))).toBe(true);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  test('workingDirectory が実在するディレクトリ → valid: true', async () => {
    mockClaudeAvailable = true;
    const os = await import('os');
    const agent = new ClaudeCodeAgent('t20', 'agent-20', { workingDirectory: os.tmpdir() });
    const result = await agent.validateConfig();
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
