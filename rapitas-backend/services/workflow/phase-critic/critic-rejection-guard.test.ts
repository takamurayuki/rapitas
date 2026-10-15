/**
 * critic-rejection-guard.test
 *
 * Unit tests for criticRejectedSince: file-type scoping, the time boundary,
 * and fail-open behavior on DB errors.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createHash } from 'crypto';

const findFirst = mock<(args?: unknown) => Promise<{ id: number } | null>>(() =>
  Promise.resolve(null),
);
const transitionFindFirstMeta = mock<(args?: unknown) => Promise<{ metadata: unknown } | null>>(
  () => Promise.resolve(null),
);
const fileFindUnique = mock<() => Promise<{ id: number } | null>>(() => Promise.resolve(null));
const versionFindFirst = mock<() => Promise<{ sha256: string; archivedAt: Date } | null>>(() =>
  Promise.resolve(null),
);

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// checkRejectedResave selects { metadata } while criticRejectedSince selects
// { id } — route by the `select` shape so one prisma mock serves both.
const routedTransitionFindFirst = mock((args: { select?: Record<string, boolean> }) =>
  args?.select?.metadata ? transitionFindFirstMeta(args) : findFirst(args),
);

mock.module('../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../../config/database', () => ({
  prisma: {
    workflowTransition: { findFirst: routedTransitionFindFirst },
    workflowFile: { findUnique: fileFindUnique },
    workflowFileVersion: { findFirst: versionFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { criticRejectedSince, checkRejectedResave, findRecentCriticBounce } =
  await import('./critic-rejection-guard');

/** sha256 of content exactly as the guard computes it (post-sanitise). */
function shaOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('criticRejectedSince', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
  });

  test('research で差し戻し遷移が見つかれば true', async () => {
    findFirst.mockResolvedValue({ id: 1 });
    const since = new Date('2026-08-07T17:00:00Z');
    expect(await criticRejectedSince(539, 'research', since)).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = (findFirst.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg).toEqual({
      where: {
        taskId: 539,
        cause: 'research_critic_failed',
        createdAt: { gt: since },
      },
      select: { id: true },
    });
  });

  test('plan は plan_critic_failed を検索する', async () => {
    findFirst.mockResolvedValue({ id: 2 });
    expect(await criticRejectedSince(1, 'plan', new Date())).toBe(true);
    const arg = (findFirst.mock.calls[0] as unknown as [{ where: { cause: string } }])[0];
    expect(arg.where.cause).toBe('plan_critic_failed');
  });

  test('差し戻し遷移が無ければ false', async () => {
    expect(await criticRejectedSince(539, 'research', new Date())).toBe(false);
  });

  test('critic 対象外の fileType は DB を見ずに false', async () => {
    expect(await criticRejectedSince(539, 'verify', new Date())).toBe(false);
    expect(await criticRejectedSince(539, 'question', new Date())).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  test('DB エラー時は fail-open で false（保存をブロックしない）', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    expect(await criticRejectedSince(539, 'research', new Date())).toBe(false);
  });
});

describe('checkRejectedResave', () => {
  const CONTENT = '# 調査結果\n\n## 前提監査\n本文';
  const ARCHIVED_AT = new Date('2026-08-07T18:40:31Z');

  beforeEach(() => {
    fileFindUnique.mockReset().mockResolvedValue(null);
    versionFindFirst
      .mockReset()
      .mockResolvedValue({ sha256: shaOf(CONTENT), archivedAt: ARCHIVED_AT });
    transitionFindFirstMeta
      .mockReset()
      .mockResolvedValue({ metadata: { severity: 72, reasons: ['指摘A', '指摘B'] } });
    findFirst.mockReset().mockResolvedValue(null);
  });

  test('却下済み成果物と同一バイトの再提出を検出し、理由を返す', async () => {
    const verdict = await checkRejectedResave(540, 'research', CONTENT);
    expect(verdict.isResave).toBe(true);
    expect(verdict.reasons).toEqual(['指摘A', '指摘B']);
    expect(verdict.severity).toBe(72);
  });

  test('内容が異なれば再提出扱いしない', async () => {
    const verdict = await checkRejectedResave(540, 'research', CONTENT + '\n改訂済み');
    expect(verdict.isResave).toBe(false);
  });

  test('live 行が存在する場合は判定しない（既に置き換え済み）', async () => {
    fileFindUnique.mockResolvedValue({ id: 1 });
    const verdict = await checkRejectedResave(540, 'research', CONTENT);
    expect(verdict.isResave).toBe(false);
    expect(versionFindFirst).not.toHaveBeenCalled();
  });

  test('直近アーカイブに対応する差し戻し遷移が無ければ判定しない', async () => {
    transitionFindFirstMeta.mockResolvedValue(null);
    const verdict = await checkRejectedResave(540, 'research', CONTENT);
    expect(verdict.isResave).toBe(false);
  });

  test('metadata が JSON 文字列でも理由を取り出せる', async () => {
    transitionFindFirstMeta.mockResolvedValue({
      metadata: JSON.stringify({ severity: 68, reasons: ['文字列メタ'] }),
    });
    const verdict = await checkRejectedResave(540, 'plan', CONTENT);
    expect(verdict.isResave).toBe(true);
    expect(verdict.reasons).toEqual(['文字列メタ']);
    expect(verdict.severity).toBe(68);
  });

  test('critic 対象外の fileType は常に非該当', async () => {
    const verdict = await checkRejectedResave(540, 'verify', CONTENT);
    expect(verdict.isResave).toBe(false);
    expect(fileFindUnique).not.toHaveBeenCalled();
  });

  test('DB エラー時は fail-open', async () => {
    versionFindFirst.mockRejectedValue(new Error('db down'));
    const verdict = await checkRejectedResave(540, 'research', CONTENT);
    expect(verdict.isResave).toBe(false);
  });
});

// Task 585: the async critic verdict lands after the agent moved on, so the
// next save is rejected with no explanation. These pin the lookup that turns
// that dead end into "revise <phase>.md — here is what the critic said".
describe('findRecentCriticBounce', () => {
  beforeEach(() => {
    transitionFindFirstMeta.mockReset().mockResolvedValue(null);
  });

  test('保存可能フェーズの差し戻しを理由付きで返す', async () => {
    transitionFindFirstMeta.mockResolvedValue({
      cause: 'research_critic_failed',
      metadata: { severity: 68, reasons: ['CSV形式が未定義', '閾値が未定義'] },
    } as unknown as { metadata: unknown });

    const bounce = await findRecentCriticBounce(585, ['research', 'question']);

    expect(bounce).not.toBeNull();
    expect(bounce?.phase).toBe('research');
    expect(bounce?.reasons).toEqual(['CSV形式が未定義', '閾値が未定義']);
    expect(bounce?.severity).toBe(68);
    // 差し戻し原因は保存可能フェーズに限定して検索する。
    const args = transitionFindFirstMeta.mock.calls[0]?.[0] as {
      where: { cause: { in: string[] } };
    };
    expect(args.where.cause.in).toEqual(['research_critic_failed']);
  });

  test('critic 対象フェーズが許可リストに無ければ検索しない', async () => {
    const bounce = await findRecentCriticBounce(585, ['verify', 'question']);
    expect(bounce).toBeNull();
    expect(transitionFindFirstMeta).not.toHaveBeenCalled();
  });

  test('該当する差し戻しが無ければ null', async () => {
    transitionFindFirstMeta.mockResolvedValue(null);
    expect(await findRecentCriticBounce(585, ['research'])).toBeNull();
  });

  test('metadata が壊れていても差し戻し自体は報告する', async () => {
    transitionFindFirstMeta.mockResolvedValue({
      cause: 'plan_critic_failed',
      metadata: '{not json',
    } as unknown as { metadata: unknown });

    const bounce = await findRecentCriticBounce(585, ['plan', 'question']);

    expect(bounce?.phase).toBe('plan');
    expect(bounce?.reasons).toEqual([]);
    expect(bounce?.severity).toBeNull();
  });

  test('DB エラー時は fail-open で null', async () => {
    transitionFindFirstMeta.mockRejectedValue(new Error('db down'));
    expect(await findRecentCriticBounce(585, ['research'])).toBeNull();
  });
});
