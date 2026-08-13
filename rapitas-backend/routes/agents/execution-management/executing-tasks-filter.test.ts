/**
 * executing-tasks-filter ユニットテスト
 *
 * selectExecutingRows() の表示鮮度判定（running の heartbeat 5分窓、
 * waiting_for_input の fail-open + セッション終端ガード）を純関数として検証する。
 * Elysia / Prisma には依存しない。
 */
import { describe, test, expect } from 'bun:test';

import {
  selectExecutingRows,
  EXECUTING_DISPLAY_STALE_MS,
  TERMINAL_SESSION_STATUSES,
  type ExecutingRowLike,
} from './executing-tasks-filter';

const NOW = new Date('2026-08-13T12:00:00Z');

/** テスト用の実行行を生成する。 */
function makeRow(overrides: Partial<ExecutingRowLike> = {}): ExecutingRowLike {
  return {
    status: 'running',
    heartbeatAt: new Date(NOW.getTime() - 1_000),
    session: { status: 'active' },
    ...overrides,
  };
}

describe('selectExecutingRows() — running 行の heartbeat 鮮度', () => {
  test('新鮮な running（heartbeat 1秒前）は維持される', () => {
    const row = makeRow();
    expect(selectExecutingRows([row], NOW)).toEqual([row]);
  });

  test('窓の境界ちょうど（now - 5分）の running は維持される', () => {
    const row = makeRow({
      heartbeatAt: new Date(NOW.getTime() - EXECUTING_DISPLAY_STALE_MS),
    });
    expect(selectExecutingRows([row], NOW)).toEqual([row]);
  });

  test('stale running（heartbeat 5分超過）は除外される', () => {
    const row = makeRow({
      heartbeatAt: new Date(NOW.getTime() - EXECUTING_DISPLAY_STALE_MS - 1),
    });
    expect(selectExecutingRows([row], NOW)).toEqual([]);
  });

  test('heartbeatAt=null の running（旧残骸行）は除外される', () => {
    const row = makeRow({ heartbeatAt: null });
    expect(selectExecutingRows([row], NOW)).toEqual([]);
  });
});

describe('selectExecutingRows() — waiting_for_input 行の fail-open', () => {
  test('セッションが live（active）なら heartbeat が stale でも維持される', () => {
    // 入力待ち中はエージェントプロセスが無く heartbeat は常に stale — 判定に使わない
    const row = makeRow({
      status: 'waiting_for_input',
      heartbeatAt: new Date(NOW.getTime() - 60 * 60_000),
      session: { status: 'active' },
    });
    expect(selectExecutingRows([row], NOW)).toEqual([row]);
  });

  test('session が null でも維持される（fail-open: 判別不能は表示する）', () => {
    const row = makeRow({ status: 'waiting_for_input', session: null });
    expect(selectExecutingRows([row], NOW)).toEqual([row]);
  });

  test('セッションが終端 status（interrupted — 570事例）なら除外される', () => {
    const row = makeRow({
      status: 'waiting_for_input',
      session: { status: 'interrupted' },
    });
    expect(selectExecutingRows([row], NOW)).toEqual([]);
  });

  test('TERMINAL_SESSION_STATUSES の全 status で除外される', () => {
    for (const status of TERMINAL_SESSION_STATUSES) {
      const row = makeRow({ status: 'waiting_for_input', session: { status } });
      expect(selectExecutingRows([row], NOW)).toEqual([]);
    }
  });
});

describe('selectExecutingRows() — その他の status と混在配列', () => {
  test('running/waiting_for_input 以外の status は除外される', () => {
    const row = makeRow({ status: 'pending' });
    expect(selectExecutingRows([row], NOW)).toEqual([]);
  });

  test('混在配列から表示可能な行のみを元の順序で返す', () => {
    const fresh = makeRow();
    const stale = makeRow({
      heartbeatAt: new Date(NOW.getTime() - EXECUTING_DISPLAY_STALE_MS - 1),
    });
    const waitingLive = makeRow({ status: 'waiting_for_input', session: { status: 'active' } });
    const waitingDead = makeRow({
      status: 'waiting_for_input',
      session: { status: 'cancelled' },
    });

    expect(selectExecutingRows([stale, fresh, waitingDead, waitingLive], NOW)).toEqual([
      fresh,
      waitingLive,
    ]);
  });
});
