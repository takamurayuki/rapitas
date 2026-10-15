/**
 * agent-core 統合テスト — 指示モデルの記録配線
 *
 * ClaudeCodeAgent.instructedModel（config.model のゲッター）が
 * handleWorkerMessageInternal → 実物の worker-message-handler.handleWorkerMessage
 * → 実物の model-attribution.pickPrimaryModel まで実際に配線されていることを検証する。
 * agent-core.test.ts 他は worker-message-handler をモック化しているため、この
 * 実行パス（agent-core → ctx 構築 → handleWorkerMessage）は他ファイルではカバーされない。
 */
import { describe, expect, mock, test } from 'bun:test';
import type { WorkerResultEvent } from '../../../workers/output-parser-types';
import {
  createPrismaMock,
  databaseModuleFactory,
  prismaModelMock,
} from '../../../tests/helpers/mock-database';

mock.module('../../../config/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getBackendLogFilePath: () => '/tmp/backend-test.log',
}));

const mockPrisma = createPrismaMock({ task: prismaModelMock() });
mock.module('../../../config/database', () => databaseModuleFactory(mockPrisma));

mock.module('./cli-utils', () => ({
  resolveCliPath: (name: string) => name,
  getClaudePath: () => 'claude.cmd',
  checkClaudeAvailable: () => Promise.resolve(true),
  buildSpawnCommand: (path: string, args: string[]) => [path, args] as [string, string[]],
}));

mock.module('./claude-execution-runner', () => ({
  buildClaudeArgs: () => ({ args: [], logExtras: [] }),
  buildSpawnEnv: () => ({}),
  runClaudeExecution: mock(() => {}),
}));

// execution-resolver は notification-service 経由で重い依存チェーン(realtime/webhook)を
// 引き込むため、この統合テストの対象外としてモックする。worker-message-handler と
// model-attribution は実物を使う（本テストの検証対象そのものであるため）。
mock.module('./execution-resolver', () => ({
  buildResolveAfterParse: mock(() => () => {}),
}));

const { ClaudeCodeAgent } = await import('./agent-core');

function resultEvent(modelUsage: WorkerResultEvent['modelUsage']): WorkerResultEvent {
  return {
    type: 'result-event',
    displayOutput: '',
    costUsd: 0,
    result: 'done',
    modelUsage,
  };
}

describe('ClaudeCodeAgent — 指示モデルの記録配線（実行2749/タスク627の再現）', () => {
  test('config.model が modelUsage に含まれていれば、コスト最大の別モデルではなく指示モデルが記録される', () => {
    const agent = new ClaudeCodeAgent('ti1', 'agent-instructed-1', { model: 'claude-sonnet-5' });

    agent.handleWorkerMessageInternal(
      resultEvent({
        'claude-sonnet-5': { inputTokens: 500, outputTokens: 200, costUsd: 0.5 },
        'claude-opus-4-8': { inputTokens: 50, outputTokens: 10, costUsd: 3.2 },
      }),
    );

    expect(agent.workerResultUsage?.modelName).toBe('claude-sonnet-5');
  });

  test('instructedModel ゲッターは config.model をそのまま返す（配線元の直接確認）', () => {
    const agent = new ClaudeCodeAgent('ti2', 'agent-instructed-2', { model: 'claude-sonnet-5' });
    expect(agent.instructedModel).toBe('claude-sonnet-5');
  });

  test('config.model が modelUsage に存在しない場合はコスト最大ロジックにフォールバックする', () => {
    const agent = new ClaudeCodeAgent('ti3', 'agent-instructed-3', { model: 'claude-sonnet-5' });

    agent.handleWorkerMessageInternal(
      resultEvent({
        'claude-haiku-4-5-20251001': { inputTokens: 9000, outputTokens: 400, costUsd: 0.01 },
        'claude-fable-5': { inputTokens: 120, outputTokens: 3000, costUsd: 7.05 },
      }),
    );

    expect(agent.workerResultUsage?.modelName).toBe('claude-fable-5');
  });

  test('config.model 未指定時は既存のコスト最大ロジックのまま（後方互換）', () => {
    const agent = new ClaudeCodeAgent('ti4', 'agent-instructed-4');

    agent.handleWorkerMessageInternal(
      resultEvent({
        'claude-haiku-4-5-20251001': { inputTokens: 9000, outputTokens: 400, costUsd: 0.01 },
        'claude-fable-5': { inputTokens: 120, outputTokens: 3000, costUsd: 7.05 },
      }),
    );

    expect(agent.workerResultUsage?.modelName).toBe('claude-fable-5');
  });
});
