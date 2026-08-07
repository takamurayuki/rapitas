/**
 * workflow-disabled.boundary.test
 *
 * Hand-written boundary tests for resolveEffectiveWorkflowDisabled — the
 * resolver is a fail-open BOOLEAN (missing task/settings → false, lookup
 * failure → false), so the generated null-contract template does not apply
 * (source carries the `boundary-tests: manual` opt-out marker).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findUniqueMock = mock(async (): Promise<unknown> => null);
const findFirstMock = mock(async (): Promise<unknown> => null);

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: findUniqueMock },
    userSettings: { findFirst: findFirstMock },
  },
}));

const { resolveEffectiveWorkflowDisabled } = await import('./workflow-disabled');

beforeEach(() => {
  findUniqueMock.mockClear();
  findFirstMock.mockClear();
  findUniqueMock.mockImplementation(async () => null);
  findFirstMock.mockImplementation(async () => null);
});

describe('resolveEffectiveWorkflowDisabled 境界値テスト', () => {
  test.each([0, -1, 2147483647, Number.NaN])(
    'タスクが存在しないとき %p は false（fail-open、null ではない）',
    async (edge) => {
      expect(await resolveEffectiveWorkflowDisabled(edge)).toBe(false);
    },
  );

  test('タスク側フラグ単独で true', async () => {
    findUniqueMock.mockImplementation(async () => ({ id: 1, workflowDisabled: true }));
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(true);
  });

  test('グローバル設定単独で true（タスク側フラグなし）', async () => {
    findUniqueMock.mockImplementation(async () => ({ id: 1, workflowDisabled: false }));
    findFirstMock.mockImplementation(async () => ({ workflowDisabledGlobally: true }));
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(true);
  });

  test('両フラグ false なら false', async () => {
    findUniqueMock.mockImplementation(async () => ({ id: 1, workflowDisabled: false }));
    findFirstMock.mockImplementation(async () => ({ workflowDisabledGlobally: false }));
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(false);
  });

  test('設定の読込失敗はタスク側フラグの判定を妨げない（fail-open）', async () => {
    findFirstMock.mockImplementation(async () => {
      throw new Error('settings lookup failed');
    });
    findUniqueMock.mockImplementation(async () => ({ id: 1, workflowDisabled: true }));
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(true);
  });

  test('タスクの読込失敗は false（fail-open — 実行をブロックしない）', async () => {
    findUniqueMock.mockImplementation(async () => {
      throw new Error('task lookup failed');
    });
    findFirstMock.mockImplementation(async () => ({ workflowDisabledGlobally: true }));
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(false);
  });
});
