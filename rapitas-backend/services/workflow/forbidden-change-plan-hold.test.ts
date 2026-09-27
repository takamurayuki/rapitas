/**
 * forbidden-change-plan-hold.test
 *
 * 2026-09-27: schema-change ゲートは `Task.forbiddenChangeOverride`(人間の
 * approve-plan のみが立てる)を必須とするため、plan がスキーマ変更を宣言している
 * タスクは実装を丸ごと払ったあとに verify で必ず拒否される(1100 は 41 ファイル、
 * 1103 は implement+verify を 1 周してから同じ壁)。plan_created の時点で保留し、
 * planner 1 回分の費用で同じ質問を人間に出せることを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

let planContent: string | null = '';
let overrideFlag: boolean | null = false;
let planThrows = false;
const workflowFileFindFirstMock = mock(() => {
  if (planThrows) return Promise.reject(new Error('db down'));
  return Promise.resolve(planContent === null ? null : { content: planContent });
});
const taskFindUniqueMock = mock(() =>
  Promise.resolve(overrideFlag === null ? null : { forbiddenChangeOverride: overrideFlag }),
);

mock.module('../../config/database', () => ({
  prisma: {
    workflowFile: { findFirst: workflowFileFindFirstMock },
    task: { findUnique: taskFindUniqueMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { resolveForbiddenChangePlanHold, buildOverrideInstruction } =
  await import('./forbidden-change-plan-hold');

/** A plan whose changed-files section declares the given paths. */
function planWith(paths: string[]): string {
  return `# 計画\n\n## 変更予定ファイル\n\n${paths.map((p) => `- \`${p}\``).join('\n')}\n`;
}

const SCHEMA = 'rapitas-backend/prisma/schema/system.prisma';

beforeEach(() => {
  planContent = '';
  overrideFlag = false;
  planThrows = false;
  workflowFileFindFirstMock.mockClear();
  taskFindUniqueMock.mockClear();
});

describe('resolveForbiddenChangePlanHold', () => {
  test('holds when the plan declares a Prisma schema file and no override exists', async () => {
    planContent = planWith([SCHEMA, 'rapitas-backend/services/x.ts']);

    const hold = await resolveForbiddenChangePlanHold(1103);

    expect(hold?.paths).toEqual([SCHEMA]);
    expect(hold?.instruction).toContain('overrideForbiddenChange');
    expect(hold?.instruction).toContain('1103');
  });

  test('does not hold once the human override is set', async () => {
    planContent = planWith([SCHEMA]);
    overrideFlag = true;

    expect(await resolveForbiddenChangePlanHold(1103)).toBeNull();
  });

  test('does not hold for a plan with no schema file', async () => {
    planContent = planWith([
      'rapitas-backend/services/workflow/workflow-runner.ts',
      'rapitas-frontend/src/app/page.tsx',
    ]);

    expect(await resolveForbiddenChangePlanHold(1109)).toBeNull();
  });

  test('ignores the GENERATED desktop schema — only source schema is the human gate', async () => {
    planContent = planWith(['rapitas-backend/prisma/schema.desktop/system.prisma']);

    expect(await resolveForbiddenChangePlanHold(1103)).toBeNull();
  });

  test.each([
    ['plan が無い', () => (planContent = null)],
    ['plan が空', () => (planContent = '')],
    ['plan 読み取りが失敗', () => (planThrows = true)],
    ['タスク行が読めない', () => (overrideFlag = null)],
  ])('情報が欠ける場合は保留しない(fail-open): %s', async (_label, arrange) => {
    planContent = planWith([SCHEMA]);
    arrange();

    expect(await resolveForbiddenChangePlanHold(1103)).toBeNull();
  });
});

describe('buildOverrideInstruction', () => {
  test('names the endpoint, the flag, and the restart consequence', () => {
    const text = buildOverrideInstruction(1100, [SCHEMA]);
    expect(text).toContain('approve-plan');
    expect(text).toContain('overrideReason');
    expect(text).toContain('再起動');
  });
});
