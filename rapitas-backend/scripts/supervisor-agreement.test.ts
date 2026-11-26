/** 読み取り経路・版の対応・実CLIの出力と書き込み禁止を検査する。 */
import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { collectRows, locateAnswers, type ReadDb } from './supervisor-agreement';
import { aggregateAgreement } from './supervisor-agreement-scoring';
import { formatAgreementReport } from './supervisor-agreement-format';
const QUESTION = `# Q\n\n\`\`\`json:options\n${JSON.stringify({
  questions: [
    {
      id: 'Q1',
      summary: 's',
      options: ['A', 'B'].map((key) => ({ key, label: key.toLowerCase() })),
      freeTextRequired: false,
      recommended: 'A',
      recommendedReason: 'r',
    },
  ],
})}\n\`\`\``;
function fakeDb(over: Partial<{ transitions: unknown[] }> = {}): ReadDb {
  const at = new Date('2026-11-01T00:00:05Z');
  const content = `${QUESTION}\n\n## 回答\n## Q1: s\n選択: a（影響: x）`;
  return {
    workflowTransition: {
      findMany: async () =>
        (over.transitions ?? []) as Awaited<ReturnType<ReadDb['workflowTransition']['findMany']>>,
    },
    workflowFileVersion: {
      findMany: async () => [{ content: QUESTION, archivedAt: at }],
    },
    workflowFile: { findFirst: async () => ({ content }) },
  };
}
describe('collectRows', () => {
  it('returns nothing for an empty db and aggregates to zero without error', async () => {
    const { cases, outOfScope } = await collectRows(fakeDb());
    expect(cases).toEqual([]);
    const report = aggregateAgreement(cases, outOfScope);
    expect(report.answers.total).toBe(0);
    const output = formatAgreementReport(report);
    expect(output).toContain('answers: 0 = counted 0 + excluded 0');
    expect(output).toContain('execution_continuation');
    expect(output).toContain('excluded answers by reason');
    expect(output).toContain('n/a');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('keeps operator proxy answers (both causes) and counts the others as out of scope', async () => {
    const transition = (
      id: number,
      taskId: number,
      cause: string,
      proxy: boolean,
      time: string,
    ) => ({
      id,
      taskId,
      cause,
      createdAt: new Date(`2026-11-01T${time}Z`),
      metadata: JSON.stringify({ sourceLabel: proxy ? 'オペレーター代理回答' : 'ユーザー選択' }),
    });
    const db = fakeDb({
      transitions: [
        transition(1, 7, 'question_resolved', true, '00:00:10'),
        transition(2, 7, 'question_resolved', false, '00:01:00'),
        transition(3, 8, 'intake_question_answered', true, '00:00:10'),
      ],
    });
    const transitionsRead = spyOn(db.workflowTransition, 'findMany');
    const versionsRead = spyOn(db.workflowFileVersion, 'findMany');
    const currentRead = spyOn(db.workflowFile, 'findFirst');
    const { cases, outOfScope } = await collectRows(db);
    expect(transitionsRead).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cause: { in: ['question_resolved', 'intake_question_answered'] } },
      }),
    );
    expect(versionsRead).toHaveBeenCalledTimes(2);
    expect(currentRead).toHaveBeenCalledTimes(2);
    for (const read of [versionsRead, currentRead]) {
      for (const taskId of [7, 8]) {
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ where: { taskId, fileType: 'question' } }),
        );
      }
    }
    expect(cases.map((c) => c.transitionId)).toEqual([1, 3]);
    expect(outOfScope).toBe(1);
    const report = aggregateAgreement(cases, outOfScope);
    expect(report.overall).toEqual({ total: 2, matched: 2, rate: 1 });
    expect(report.byKind.spec_change.total).toBe(1);
    expect(report.selectionSource.label).toBe(2);
  });
});
describe('locateAnswers (version diff)', () => {
  const at = (s: string) => new Date(`2026-11-01T${s}Z`);
  const pre = '# Q\nbody';
  const ansA = `${pre}\n\n## 回答\nanswer A`;
  const ansB = `${ansA}\n\n## 回答\nanswer B`;
  const v = (content: string, time: string) => ({ content, archivedAt: at(time) });
  /** Locate a single answer id 1 at `time`. */
  const one = (versions: ReturnType<typeof v>[], current: string | null, time: string) =>
    locateAnswers(versions, current, [{ id: 1, at: at(time) }]).get(1);
  it('first answer: pre is the latest version, the answer is the remainder of the next content', () => {
    expect(one([v(pre, '00:00:09')], ansA, '00:00:10')).toEqual({
      questionBefore: pre,
      answerText: 'answer A',
    });
  });
  it('uses the version after pre when it exists, not the current file', () => {
    const r = one([v(pre, '00:00:09'), v(ansA, '01:00:00')], ansB, '00:00:10');
    expect(r?.answerText).toBe('answer A');
  });
  it('30 second apart answers A and B each get their own pre and body', () => {
    const versions = [v(ansA, '00:00:39'), v(pre, '00:00:09')];
    const original = [...versions];
    const answers = [
      { id: 1, at: at('00:00:10') },
      { id: 2, at: at('00:00:40') },
    ];
    for (const list of [answers, [...answers].reverse()]) {
      const m = locateAnswers(versions, ansB, list);
      expect(m.get(1)).toEqual({ questionBefore: pre, answerText: 'answer A' });
      expect(m.get(2)).toEqual({ questionBefore: ansA, answerText: 'answer B' });
    }
    expect(versions).toEqual(original);
  });
  it('never picks a version archived before the previous answer (no_prior_version instead)', () => {
    const m = locateAnswers([v(pre, '00:00:09')], ansB, [
      { id: 1, at: at('00:00:10') },
      { id: 2, at: at('00:00:40') },
    ]);
    expect(m.get(1)?.answerText).toBe('answer A');
    expect(m.get(2)).toBeNull();
  });
  it('two answers within 5 seconds that resolve to the same pre are both ambiguous', () => {
    const m = locateAnswers([v(pre, '00:00:09'), v(ansA, '00:00:11')], ansB, [
      { id: 1, at: at('00:00:10') },
      { id: 2, at: at('00:00:12') },
    ]);
    for (const id of [1, 2]) {
      expect(m.get(id)).toEqual({
        questionBefore: null,
        answerText: null,
        versionError: 'answer_version_ambiguous',
      });
    }
  });
  it('versions sharing the latest archivedAt make pre ambiguous', () => {
    const r = one([v(pre, '00:00:09'), v(ansA, '00:00:09')], ansB, '00:00:10');
    expect(r?.versionError).toBe('answer_version_ambiguous');
  });
  it('a duplicated post keeps pre but reports the body as ambiguous', () => {
    const r = one([v(pre, '00:00:09'), v(ansA, '00:00:39'), v(ansA, '00:00:39')], ansB, '00:00:10');
    expect(r).toEqual({
      questionBefore: pre,
      answerText: null,
      answerError: 'answer_version_ambiguous',
    });
  });
  it('post that does not start with pre: body unrecoverable, pre kept', () => {
    expect(one([v(pre, '00:00:09')], 'rewritten', '00:00:10')).toEqual({
      questionBefore: pre,
      answerText: null,
      answerError: 'answer_body_unrecoverable',
    });
  });
  it('allows a 5 second clock skew and no more', () => {
    expect(one([v(pre, '00:00:15')], ansA, '00:00:10')?.questionBefore).toBe(pre);
    expect(one([v(pre, '00:00:15.001')], ansA, '00:00:10')).toBeNull();
  });
  it('never substitutes the current file for pre', () => {
    expect(one([], ansA, '00:00:10')).toBeNull();
  });
});
describe('versions that cannot be matched are excluded and the report still adds up', () => {
  const scenarios = [
    ['same-time versions', 'answer_version_ambiguous', false],
    ['missing versions', 'no_prior_version', false],
    ['post does not start with pre', 'answer_body_unrecoverable', true],
    ['post missing', 'answer_body_unrecoverable', true],
    ['duplicated post', 'answer_version_ambiguous', true],
  ] as const;
  it.each(scenarios)('%s', async (scenario, reason, scoredWithSelections) => {
    const version = { content: QUESTION, archivedAt: new Date('2026-11-01T00:00:09Z') };
    const answered = `${QUESTION}\n\n## 回答\n## Q1: s\n選択: a`;
    for (const selections of [null, [{ questionId: 'Q1', selectedKey: 'A' }]]) {
      const db = fakeDb({
        transitions: [
          {
            id: 1,
            taskId: 7,
            cause: 'question_resolved',
            createdAt: new Date('2026-11-01T00:00:10Z'),
            metadata: { sourceLabel: 'オペレーター代理回答', selections },
          },
        ],
      });
      const later = { content: answered, archivedAt: new Date('2026-11-01T00:00:39Z') };
      db.workflowFileVersion.findMany = async () =>
        scenario === 'missing versions'
          ? []
          : scenario === 'same-time versions'
            ? [version, { ...version }]
            : scenario === 'duplicated post'
              ? [version, later, { ...later }]
              : [version];
      db.workflowFile.findFirst = async () =>
        scenario === 'post missing'
          ? null
          : { content: scenario === 'post does not start with pre' ? '書き換え後' : answered };
      const { cases, outOfScope } = await collectRows(db);
      const report = aggregateAgreement(cases, outOfScope);
      const scored = scoredWithSelections && selections !== null;
      expect(report.answers).toEqual(
        scored
          ? { total: 1, counted: 1, excluded: { total: 0, byReason: {} } }
          : { total: 1, counted: 0, excluded: { total: 1, byReason: { [reason]: 1 } } },
      );
      expect(report.questions.counted + report.questions.excluded.total).toBe(
        report.questions.total,
      );
      if (!scored) expect(formatAgreementReport(report)).toContain(reason);
    }
  });
  it('a read failure is passed to the caller, never reported as success', async () => {
    const db = fakeDb();
    db.workflowTransition.findMany = async () => {
      throw new Error('読み取り失敗');
    };
    await expect(collectRows(db)).rejects.toThrow('読み取り失敗');
  });
});
describe('実CLIの出力契約', () => {
  const snapshot = resolve(import.meta.dir, '../../rapitas-desktop/.data/rapitas-live-snapshot.db');
  const run = (path: string, json: boolean, mode = 'test') => {
    const script = resolve(import.meta.dir, 'supervisor-agreement.ts');
    const proc = Bun.spawnSync([process.execPath, script, ...(json ? ['--json'] : [])], {
      env: {
        ...process.env,
        NODE_ENV: mode,
        LOG_LEVEL: 'info',
        RAPITAS_DB_PROVIDER: 'sqlite',
        DATABASE_URL: `file:${path.replaceAll('\\', '/')}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
  };
  it('空DBでも標準出力全体がJSONになり、表は全9理由の0件を表示する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rapitas-1531-cli-'));
    const path = join(dir, 'empty.db');
    const db = new Database(path);
    try {
      db.exec(
        'CREATE TABLE WorkflowTransition (id INTEGER, taskId INTEGER, cause TEXT, createdAt DATETIME, metadata TEXT)',
      );
      db.close();
      for (const mode of ['test', 'production']) {
        const result = run(path, true, mode);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(aggregateAgreement([], 0));
      }
      const result = run(path, false);
      expect(result.code).toBe(0);
      expect(result.stdout.match(/^\s+[a-z_]+\s+0$/gm)).toHaveLength(20);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!existsSync(snapshot))('指定スナップショットのJSONを解析でき、DBを変更しない', () => {
    const before = Bun.hash(readFileSync(snapshot));
    const result = run(snapshot, true);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.answers.total).toBe(report.answers.counted + report.answers.excluded.total);
    expect(Bun.hash(readFileSync(snapshot))).toBe(before);
  });
  it('読取失敗時は非0終了し、詳細を標準エラーだけに出す', () => {
    const result = run(join(tmpdir(), 'rapitas-1531-missing-directory', 'absent.db'), true);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[supervisor-agreement]');
  });
});
it('the script source calls no prisma write method', () => {
  const src = readFileSync(new URL('./supervisor-agreement.ts', import.meta.url), 'utf8');
  const writes =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$queryRaw|\$queryRawUnsafe|\$transaction)\s*[(`]/;
  expect(src).not.toMatch(writes);
});
it('the formatter imports no prisma', () => {
  const src = readFileSync(new URL('./supervisor-agreement-format.ts', import.meta.url), 'utf8');
  const imports = src.split('\n').filter((l) => /from\s+['"]/.test(l));
  expect(imports.join('\n')).not.toMatch(/prisma|database/i);
});
