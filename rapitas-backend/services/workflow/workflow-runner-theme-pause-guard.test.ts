/**
 * workflow-runner-theme-pause-guard.test
 *
 * A paused/stopping theme must hand its slot back before the next phase: the item goes
 * back to `queued` and the loop stops. Running/idle/unknown themes and read failures proceed.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const loggerMock = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => loggerMock,
  logger: loggerMock,
  getBackendLogFilePath: () => '/tmp/fake-backend.log',
}));

let taskRow: { themeId: number | null } | null = { themeId: 35 };
let themeRun: { status: string } | null = { status: 'paused_user' };
let throwOnRead = false;
mock.module('../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(() =>
        throwOnRead ? Promise.reject(new Error('db')) : Promise.resolve(taskRow),
      ),
    },
    themeAutoRun: {
      findFirst: mock(() => Promise.resolve(themeRun)),
    },
  },
}));

const { parkItemIfThemeHalted } = await import('./workflow-runner-theme-pause-guard');

const updateStatus = mock(async () => ({}));
const item = { id: 9, taskId: 1420 };

describe('parkItemIfThemeHalted', () => {
  beforeEach(() => {
    updateStatus.mockClear();
    taskRow = { themeId: 35 };
    themeRun = { status: 'paused_user' };
    throwOnRead = false;
  });

  test.each(['paused', 'paused_user', 'paused_approval', 'stopping'])(
    '%s のテーマでは項目を queued に戻して true',
    async (status) => {
      themeRun = { status };
      const events: string[] = [];
      expect(
        await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', (e) => events.push(e)),
      ).toBe(true);
      expect(updateStatus).toHaveBeenCalledWith(9, 'queued', { currentPhase: 'in_progress' });
      expect(events).toEqual(['execution_requeued']);
    },
  );

  test.each(['running', 'idle'])('%s のテーマでは何もしない', async (status) => {
    themeRun = { status };
    expect(await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', () => {})).toBe(
      false,
    );
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test('ThemeAutoRun 行が無ければ false', async () => {
    themeRun = null;
    expect(await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', () => {})).toBe(
      false,
    );
  });

  test('テーマに属さないタスクは false', async () => {
    taskRow = { themeId: null };
    expect(await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', () => {})).toBe(
      false,
    );
  });

  test('読み取り失敗は進行を止めない（fail-open）', async () => {
    throwOnRead = true;
    expect(await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', () => {})).toBe(
      false,
    );
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test('書き込み失敗でも例外にせず false（次フェーズへ進めて既存経路に任せる）', async () => {
    const failing = mock(async () => {
      throw new Error('write failed');
    });
    expect(
      await parkItemIfThemeHalted({ updateStatus: failing }, item, 'in_progress', () => {}),
    ).toBe(false);
  });

  test('割り込み: 状態を読んだ直後にテーマが再開されても、項目は queued のまま失われない', async () => {
    const resumeDuringWrite = mock(async () => {
      themeRun = { status: 'running' };
      return {};
    });
    const events: string[] = [];
    expect(
      await parkItemIfThemeHalted({ updateStatus: resumeDuringWrite }, item, 'in_progress', (e) =>
        events.push(e),
      ),
    ).toBe(true);
    expect(resumeDuringWrite).toHaveBeenCalledWith(9, 'queued', { currentPhase: 'in_progress' });
    // 再開後の再評価では止めない（同じ項目が再び dequeue されて進める）
    expect(await parkItemIfThemeHalted({ updateStatus }, item, 'in_progress', () => {})).toBe(
      false,
    );
  });
});
