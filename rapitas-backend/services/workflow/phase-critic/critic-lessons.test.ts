/**
 * critic-lessons.test
 *
 * Unit tests for the cross-task critic-lesson loop: the tolerant response
 * parser, the section renderer, and the orchestration (source thresholds,
 * caching, fail-soft). Prisma / ai-client / logger are mocked.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const findManyMock = mock(async (): Promise<unknown[]> => []);

mock.module('../../../config/database', () => ({
  prisma: { workflowTransition: { findMany: findManyMock } },
}));

const sendAIMessageMock = mock(async () => ({ content: '[]' }));
const isAnyApiKeyConfiguredMock = mock(async () => true);

mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: sendAIMessageMock,
  getDefaultProvider: mock(async () => 'anthropic'),
  isAnyApiKeyConfigured: isAnyApiKeyConfiguredMock,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

const { buildCriticLessonsSection, parseLessonsResponse, renderLessonsSection } =
  await import('./critic-lessons');

/** A critic-failure transition row with the given task + reasons. */
function row(id: number, taskId: number, reasons: string[]) {
  return { id, taskId, metadata: JSON.stringify({ severity: 60, reasons }) };
}

beforeEach(() => {
  findManyMock.mockClear();
  sendAIMessageMock.mockClear();
  isAnyApiKeyConfiguredMock.mockClear();
  findManyMock.mockImplementation(async () => []);
  sendAIMessageMock.mockImplementation(async () => ({ content: '[]' }));
  isAnyApiKeyConfiguredMock.mockImplementation(async () => true);
});

afterEach(() => {
  delete process.env.RAPITAS_CRITIC_LESSONS;
});

describe('parseLessonsResponse', () => {
  it('parses a clean JSON array', () => {
    expect(parseLessonsResponse('["a","b"]')).toEqual(['a', 'b']);
  });

  it('extracts an array embedded in prose', () => {
    expect(parseLessonsResponse('結果: ["観点1"] 以上')).toEqual(['観点1']);
  });

  it('returns [] for non-JSON and non-array payloads', () => {
    expect(parseLessonsResponse('no json')).toEqual([]);
    expect(parseLessonsResponse('{"a":1}')).toEqual([]);
  });

  it('drops non-string, empty, and oversized items', () => {
    const long = 'x'.repeat(500);
    expect(parseLessonsResponse(JSON.stringify(['ok', 42, '', long]))).toEqual(['ok']);
  });

  it('caps the number of lessons at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => `観点${i}`);
    expect(parseLessonsResponse(JSON.stringify(many))).toHaveLength(8);
  });
});

describe('renderLessonsSection', () => {
  it('returns empty string with no bullets', () => {
    expect(renderLessonsSection([], 'research')).toBe('');
  });

  it('renders a checkbox list with the phase artifact in the header', () => {
    const s = renderLessonsSection(['影響ファイルを列挙する'], 'research', 'ja');
    expect(s).toContain('research.md');
    expect(s).toContain('- [ ] 影響ファイルを列挙する');
  });

  it('uses plan.md for the plan phase and English framing when asked', () => {
    const s = renderLessonsSection(['x'], 'plan', 'en');
    expect(s).toContain('plan.md');
    expect(s).toContain('Recurring misses');
  });
});

describe('buildCriticLessonsSection', () => {
  it('returns "" when disabled via env', async () => {
    process.env.RAPITAS_CRITIC_LESSONS = 'off';
    expect(await buildCriticLessonsSection('research')).toBe('');
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns "" below the source thresholds (too few reasons)', async () => {
    findManyMock.mockImplementation(async () => [row(1, 10, ['a', 'b'])]);
    expect(await buildCriticLessonsSection('research')).toBe('');
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });

  it('returns "" when all findings come from a single task (not cross-task)', async () => {
    findManyMock.mockImplementation(async () => [
      row(1, 10, ['a', 'b']),
      row(2, 10, ['c', 'd', 'e']),
    ]);
    expect(await buildCriticLessonsSection('research')).toBe('');
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });

  it('distills and renders when findings recur across tasks', async () => {
    findManyMock.mockImplementation(async () => [
      row(3, 10, ['[completeness] 影響ファイルの列挙漏れ', '[risk] 移行戦略なし']),
      row(2, 11, ['[completeness] バージョン要件未確認', '[risk] ロールバック手順なし']),
    ]);
    sendAIMessageMock.mockImplementation(async () => ({
      content: '["変更の影響ファイルを網羅的に列挙する","移行・ロールバック手順を明記する"]',
    }));
    const s = await buildCriticLessonsSection('research', 'ja');
    expect(s).toContain('- [ ] 変更の影響ファイルを網羅的に列挙する');
    expect(sendAIMessageMock).toHaveBeenCalledTimes(1);
  });

  it('serves the cached distillation for an unchanged fingerprint', async () => {
    // NOTE: distinct ids from other tests — the module-level cache persists
    // across tests, and identical ids would collide on the fingerprint.
    findManyMock.mockImplementation(async () => [
      row(103, 10, ['r1', 'r2']),
      row(102, 11, ['r3', 'r4']),
    ]);
    sendAIMessageMock.mockImplementation(async () => ({ content: '["観点A","観点B"]' }));
    const first = await buildCriticLessonsSection('research');
    const second = await buildCriticLessonsSection('research');
    expect(first).toBe(second);
    expect(sendAIMessageMock).toHaveBeenCalledTimes(1); // second hit is cached
  });

  it('re-distills when a new failure changes the fingerprint', async () => {
    findManyMock.mockImplementation(async () => [
      row(205, 10, ['r1', 'r2']),
      row(102, 11, ['r3', 'r4']),
    ]);
    sendAIMessageMock.mockImplementation(async () => ({ content: '["観点C"]' }));
    // NOTE: cache from the prior test persists (module-level) — id 205 differs
    // from id 103, so the fingerprint changes and a fresh distillation runs.
    await buildCriticLessonsSection('research');
    expect(sendAIMessageMock).toHaveBeenCalledTimes(1);
  });

  it('fails soft to "" when the DB query throws', async () => {
    findManyMock.mockImplementation(async () => {
      throw new Error('db down');
    });
    expect(await buildCriticLessonsSection('plan')).toBe('');
  });

  it('returns "" when no API key is configured (no distillation possible)', async () => {
    findManyMock.mockImplementation(async () => [
      row(9, 20, ['p1', 'p2']),
      row(8, 21, ['p3', 'p4']),
    ]);
    isAnyApiKeyConfiguredMock.mockImplementation(async () => false);
    expect(await buildCriticLessonsSection('plan')).toBe('');
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });
});
