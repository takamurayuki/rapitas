/**
 * workflow-orchestrator-protected-path-guard.test
 *
 * Fixture follows task 1055 (2026-09-24): a lightweight, human-filed task whose
 * research.md planned a change to .github/workflows/update-lockfiles.yml and
 * lost a verify round to the tamper tripwire because no plan.md could list it.
 *
 * Run this file on its own: bun's mock.module is process-global and this file
 * replaces the prisma client, logger, file reader, recorder and redispatch.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const updates: Array<Record<string, unknown>> = [];
mock.module('../../config', () => ({
  prisma: {
    task: {
      update: async (args: Record<string, unknown>) => {
        updates.push(args);
        return {};
      },
    },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
let research: string | null = null;
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: async (_id: number, type: string) => (type === 'research' ? research : null),
}));
const transitions: Array<Record<string, unknown>> = [];
mock.module('./transition-recorder', () => ({
  recordTransition: async (t: Record<string, unknown>) => {
    transitions.push(t);
  },
}));
const redispatches: Array<[number, string]> = [];
mock.module('./workflow-redispatch', () => ({
  scheduleWorkflowRedispatch: (id: number, cause: string) => {
    redispatches.push([id, cause]);
  },
}));

const { guardProtectedPathMode, plannedChangeSection, PROTECTED_PATH_ESCALATION_CAUSE } =
  await import('./workflow-orchestrator-protected-path-guard');

const IMPLEMENTER = { role: 'implementer', outputFile: null, nextStatus: 'in_progress' } as const;
const RESEARCHER = {
  role: 'researcher',
  outputFile: 'research',
  nextStatus: 'research_done',
} as const;

const RESEARCH_1055 = `# タスク調査レポート

## 前提監査
検証ゲート自体は services/agents/verification/ にあるが本タスクの対象ではない。

## 影響範囲分析

### 変更予定箇所

| # | ファイル | 変更概要 |
| -- | --- | --- |
| 1 | \`.github/workflows/update-lockfiles.yml\` | pnpm install に --no-frozen-lockfile を追加 |

### 依存関係マップ
`;

beforeEach(() => {
  updates.length = 0;
  transitions.length = 0;
  redispatches.length = 0;
  research = null;
});

describe('plannedChangeSection', () => {
  test('変更予定箇所 の表だけを切り出し、文脈で触れた保護パスは含めない', () => {
    const s = plannedChangeSection(RESEARCH_1055);
    expect(s).toContain('update-lockfiles.yml');
    expect(s).not.toContain('services/agents/verification/');
    expect(s).not.toContain('依存関係マップ');
  });

  test('見出しが無ければ全文を返す', () => {
    expect(plannedChangeSection('no headings here')).toBe('no headings here');
  });
});

describe('guardProtectedPathMode', () => {
  test('task 1055: 軽量モードの実装者前に保護パス計画を検知して standard へ昇格し再ディスパッチ', async () => {
    research = RESEARCH_1055;
    const r = await guardProtectedPathMode(1055, IMPLEMENTER, 'lightweight', 'ja');
    expect(r.done).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { id: 1055 },
      data: { workflowMode: 'standard', workflowModeOverride: true },
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      taskId: 1055,
      fromStatus: 'research_done',
      toStatus: 'research_done',
      cause: PROTECTED_PATH_ESCALATION_CAUSE,
    });
    expect(redispatches).toEqual([[1055, PROTECTED_PATH_ESCALATION_CAUSE]]);
    if (r.done) expect(r.result.status).toBe('research_done');
  });

  test('保護パスが文脈にしか無ければ何もしない', async () => {
    research = RESEARCH_1055.replace(
      '`.github/workflows/update-lockfiles.yml`',
      '`rapitas-backend/package.json`',
    );
    const r = await guardProtectedPathMode(1, IMPLEMENTER, 'lightweight', 'ja');
    expect(r.done).toBe(false);
    expect(updates).toHaveLength(0);
    expect(redispatches).toHaveLength(0);
  });

  test('plan モードや実装者以外のロールには適用しない', async () => {
    research = RESEARCH_1055;
    expect((await guardProtectedPathMode(1, IMPLEMENTER, 'standard', 'ja')).done).toBe(false);
    expect((await guardProtectedPathMode(1, RESEARCHER, 'lightweight', 'ja')).done).toBe(false);
    expect(updates).toHaveLength(0);
  });

  test('research.md が無ければ何もしない', async () => {
    research = null;
    expect((await guardProtectedPathMode(1, IMPLEMENTER, 'lightweight', 'ja')).done).toBe(false);
  });
});
