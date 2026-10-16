/**
 * juror-scheduling.test
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mapJurors, isJuryParallel } from './juror-scheduling';

beforeEach(() => {
  delete process.env.RAPITAS_JURY_PARALLEL;
});
afterAll(() => {
  delete process.env.RAPITAS_JURY_PARALLEL;
});

/** Each juror records when it starts and ends so overlap is observable. */
function tracked() {
  const events: string[] = [];
  const ask = (name: string) =>
    new Promise<string>((resolve) => {
      events.push(`${name}:start`);
      setTimeout(() => {
        events.push(`${name}:end`);
        resolve(`${name}-verdict`);
      }, 5);
    });
  return { events, ask };
}

describe('mapJurors', () => {
  test('既定は逐次: 次の陪審員は前の 1 人が終わってから呼ばれ、順序と全員分の結果を保つ', async () => {
    expect(isJuryParallel()).toBe(false);
    const { events, ask } = tracked();
    const verdicts = await mapJurors(['a', 'b', 'c'], ask);
    expect(verdicts).toEqual(['a-verdict', 'b-verdict', 'c-verdict']);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  test('RAPITAS_JURY_PARALLEL=1 で従来の同時問い合わせ', async () => {
    process.env.RAPITAS_JURY_PARALLEL = '1';
    const { events, ask } = tracked();
    const verdicts = await mapJurors(['a', 'b', 'c'], ask);
    expect(verdicts).toEqual(['a-verdict', 'b-verdict', 'c-verdict']);
    expect(events.slice(0, 3)).toEqual(['a:start', 'b:start', 'c:start']);
  });

  test('1 人が reject すれば全体も reject（Promise.all と同じ契約）', async () => {
    await expect(
      mapJurors(['a', 'b'], async (j) => {
        if (j === 'b') throw new Error('juror down');
        return j;
      }),
    ).rejects.toThrow('juror down');
  });
});
