/**
 * self-development-theme.test
 *
 * Task 587: a self-detected concern about rapitas' own tables inherited the
 * origin task's theme (コンバーター) and was promoted into that project, where
 * the agent could only report "対象コードなし" and burn its repair budget.
 * These pin the resolver that routes such findings back to rapitas.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

const execMock = mock((_cmd: string, _opts: unknown, cb: unknown) => {
  (cb as (e: Error | null, r: { stdout: string }) => void)(null, {
    stdout: 'C:\\Projects\\rapitas\n',
  });
  return undefined as never;
});
const themeFindMany = mock(() =>
  Promise.resolve([] as Array<{ id: number; workingDirectory: string | null }>),
);

mock.module('child_process', () => ({ exec: execMock }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../config/database', () => ({
  prisma: { theme: { findMany: themeFindMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { resolveSelfDevelopmentThemeId, resetSelfDevelopmentThemeCache } =
  await import('./self-development-theme');

describe('resolveSelfDevelopmentThemeId', () => {
  beforeEach(() => {
    resetSelfDevelopmentThemeCache();
    themeFindMany.mockReset().mockResolvedValue([]);
  });

  test('バックエンドの git ルートと一致するテーマを返す', async () => {
    themeFindMany.mockResolvedValue([
      { id: 25, workingDirectory: 'C:\\Projects\\ime-live-converter' },
      { id: 1, workingDirectory: 'C:\\Projects\\rapitas' },
    ]);
    expect(await resolveSelfDevelopmentThemeId()).toBe(1);
  });

  test('区切り文字・大小文字・末尾スラッシュの違いを吸収する', async () => {
    themeFindMany.mockResolvedValue([{ id: 7, workingDirectory: 'c:/projects/RAPITAS/' }]);
    expect(await resolveSelfDevelopmentThemeId()).toBe(7);
  });

  test('一致するテーマが無ければ null（呼び出し側は従来動作にフォールバック）', async () => {
    themeFindMany.mockResolvedValue([
      { id: 25, workingDirectory: 'C:\\Projects\\ime-live-converter' },
    ]);
    expect(await resolveSelfDevelopmentThemeId()).toBeNull();
  });

  test('workingDirectory が null のテーマを誤って選ばない', async () => {
    themeFindMany.mockResolvedValue([{ id: 9, workingDirectory: null }]);
    expect(await resolveSelfDevelopmentThemeId()).toBeNull();
  });

  test('解決結果はキャッシュされ、DBを再照会しない', async () => {
    themeFindMany.mockResolvedValue([{ id: 1, workingDirectory: 'C:\\Projects\\rapitas' }]);
    await resolveSelfDevelopmentThemeId();
    await resolveSelfDevelopmentThemeId();
    expect(themeFindMany).toHaveBeenCalledTimes(1);
  });
});
