/**
 * resume-tenure.test
 *
 * Pins the tenure-start clamps the hang backstop depends on. The load-bearing
 * fixture is task 1116's real timeline on 2026-10-06: theme 1 paused at 07:31
 * UTC with 1116 current, resumed at 10:35:53, and the backstop fired at 10:36:06
 * reporting wallMinutes 45 — 13 seconds of actual work. The task was healthy and
 * completed as PR 836.
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import {
  resolveResumedTenureStart,
  resolveAutoRunRestartTenureStart,
  resolveProgressTenureStart,
} from './resume-tenure';

const T = (iso: string) => new Date(iso).getTime();

/** Minimal prisma stub: only the two reads these functions make. */
function stub(opts: {
  startedAt?: Date | null;
  themeRow?: boolean;
  answeredAt?: Date | null;
  throwOnTheme?: boolean;
}): PrismaClient {
  return {
    themeAutoRun: {
      findFirst: () =>
        opts.throwOnTheme
          ? Promise.reject(new Error('db down'))
          : Promise.resolve(opts.themeRow === false ? null : { startedAt: opts.startedAt ?? null }),
    },
    workflowTransition: {
      findFirst: () => Promise.resolve(opts.answeredAt ? { createdAt: opts.answeredAt } : null),
    },
  } as unknown as PrismaClient;
}

describe('resolveAutoRunRestartTenureStart', () => {
  // Task 1116: without the clamp the tenure reads 3h18m and the backstop fires.
  test('一時停止→再開で、在任起点が再開時刻まで前進する', async () => {
    const lastRunAt = T('2026-10-06T07:17:07.968Z');
    const resumedAt = T('2026-10-06T10:35:53.341Z');
    const got = await resolveAutoRunRestartTenureStart(
      stub({ startedAt: new Date(resumedAt) }),
      1,
      lastRunAt,
    );
    expect(got).toBe(resumedAt);
    // The backstop evaluated 13 s after the resume must now see 13 s, not 45 min.
    const tenureAtBackstop = T('2026-10-06T10:36:06.288Z') - got;
    expect(tenureAtBackstop).toBeLessThan(60_000);
  });

  test('startedAt が在任起点より古ければ起点は動かない(在任を延ばさない)', async () => {
    const lastRunAt = T('2026-10-06T10:00:00.000Z');
    const got = await resolveAutoRunRestartTenureStart(
      stub({ startedAt: new Date(T('2026-10-05T16:58:29.048Z')) }),
      1,
      lastRunAt,
    );
    expect(got).toBe(lastRunAt);
  });

  // Fail CLOSED: an unreadable row must not exempt the task from the backstop.
  test('行が無い / startedAt が null なら起点はそのまま', async () => {
    const lastRunAt = T('2026-10-06T07:00:00.000Z');
    expect(await resolveAutoRunRestartTenureStart(stub({ themeRow: false }), 1, lastRunAt)).toBe(
      lastRunAt,
    );
    expect(await resolveAutoRunRestartTenureStart(stub({ startedAt: null }), 1, lastRunAt)).toBe(
      lastRunAt,
    );
  });

  test('DB エラーでも起点はそのまま(例外を投げない)', async () => {
    const lastRunAt = T('2026-10-06T07:00:00.000Z');
    expect(await resolveAutoRunRestartTenureStart(stub({ throwOnTheme: true }), 1, lastRunAt)).toBe(
      lastRunAt,
    );
  });

  // Every scheduler test's prisma mock omits themeAutoRun, so the property access
  // throws synchronously — a promise .catch() cannot see that.
  test('themeAutoRun モデルが無い部分モックでも例外にならない', async () => {
    const lastRunAt = T('2026-10-06T07:00:00.000Z');
    const partial = { task: {} } as unknown as PrismaClient;
    expect(await resolveAutoRunRestartTenureStart(partial, 1, lastRunAt)).toBe(lastRunAt);
  });
});

describe('resolveResumedTenureStart', () => {
  test('質問回答で在任起点が回答時刻まで前進する', async () => {
    const original = T('2026-10-06T07:00:00.000Z');
    const answered = T('2026-10-06T09:30:00.000Z');
    expect(
      await resolveResumedTenureStart(stub({ answeredAt: new Date(answered) }), 1116, original),
    ).toBe(answered);
  });

  test('回答が無ければ起点はそのまま', async () => {
    const original = T('2026-10-06T07:00:00.000Z');
    expect(await resolveResumedTenureStart(stub({ answeredAt: null }), 1116, original)).toBe(
      original,
    );
  });
});

describe('resolveProgressTenureStart (task 1563)', () => {
  const original = T('2026-11-26T10:00:00.000Z');
  const mk = (opts: { bounce?: Date | null; run?: Date | null; failBounce?: boolean }) =>
    ({
      workflowTransition: {
        findFirst: () =>
          opts.failBounce
            ? Promise.reject(new Error('db down'))
            : Promise.resolve(opts.bounce ? { createdAt: opts.bounce } : null),
      },
      agentExecution: {
        findFirst: () => Promise.resolve(opts.run ? { startedAt: opts.run } : null),
      },
    }) as unknown as PrismaClient;

  test('verify_repair / question_resolved の遷移まで起点が前進する', async () => {
    const at = new Date(T('2026-11-26T11:00:00.000Z'));
    expect(await resolveProgressTenureStart(mk({ bounce: at }), 1, original)).toBe(at.getTime());
  });

  test('最新の実行開始まで前進し、遷移と実行の遅い方を採る', async () => {
    const bounce = new Date(T('2026-11-26T11:00:00.000Z'));
    const run = new Date(T('2026-11-26T12:00:00.000Z'));
    expect(await resolveProgressTenureStart(mk({ bounce, run }), 1, original)).toBe(run.getTime());
  });

  test('信号が無ければ起点は動かない', async () => {
    expect(await resolveProgressTenureStart(mk({}), 1, original)).toBe(original);
  });

  test('片方の照会が失敗しても、もう片方の信号は使う', async () => {
    const run = new Date(T('2026-11-26T12:00:00.000Z'));
    expect(await resolveProgressTenureStart(mk({ failBounce: true, run }), 1, original)).toBe(
      run.getTime(),
    );
  });

  test('モデルが無い（同期例外）部分モックでも起点を返す', async () => {
    expect(await resolveProgressTenureStart({} as unknown as PrismaClient, 1, original)).toBe(
      original,
    );
  });

  test('original より古い信号は起点を後退させない（時刻は前進のみ）', async () => {
    const stale = new Date(T('2026-11-26T09:00:00.000Z'));
    expect(await resolveProgressTenureStart(mk({ bounce: stale, run: stale }), 1, original)).toBe(
      original,
    );
  });

  test('同じ時刻の信号でも起点は動かない（境界）', async () => {
    const same = new Date(original);
    expect(await resolveProgressTenureStart(mk({ bounce: same, run: same }), 1, original)).toBe(
      original,
    );
  });

  test('照会は固定の cause と task 絞り込み（session.config.taskId）だけを使う', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      workflowTransition: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          seen.push(a.where);
          return null;
        },
      },
      agentExecution: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          seen.push(a.where);
          return null;
        },
      },
    } as unknown as PrismaClient;
    await resolveProgressTenureStart(prisma, 77, original);
    expect(seen[0]).toMatchObject({
      taskId: 77,
      // NOTE: task 1572 adds the parallel re-check pass as a forward step.
      cause: { in: ['verify_repair', 'question_resolved', 'parallel_recheck_passed'] },
    });
    expect(seen[1]).toMatchObject({ session: { config: { taskId: 77 } } });
  });
});
