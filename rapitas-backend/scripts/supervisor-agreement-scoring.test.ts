/** supervisor-agreement-scoring tests: judgements, restoration, aggregation, accounting. */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  composeAutoAnswerText,
  parseQuestionOptionsBlock,
  type ParsedQuestion,
  type ParsedQuestionOption as Opt,
} from '../services/workflow/question-options-parser';
import { aggregateAgreement, judgeCase, type AnswerCase } from './supervisor-agreement-scoring';
import { formatAgreementReport } from './supervisor-agreement-format';
type Q = Pick<ParsedQuestion, 'id' | 'recommended' | 'options'>;

/** Build a question.md body carrying one json:options block. */
function questionMd(questions: Q[], kind?: string): string {
  const block = {
    ...(kind ? { kind } : {}),
    questions: questions.map((q) => ({
      ...q,
      summary: `summary ${q.id}`,
      freeTextRequired: false,
      recommendedReason: 'r',
    })),
  };
  return `# Q\n\n\`\`\`json:options\n${JSON.stringify(block)}\n\`\`\``;
}

const OPTS: Opt[] = [
  { key: 'A', label: 'adopt it', consequence: 'c1' },
  { key: 'B', label: 'skip it (soft)', consequence: 'c2', mutatesGate: true },
];
const MD1 = questionMd([{ id: 'Q1', recommended: 'A', options: OPTS }]);

/** The answer body the UI/auto-answer would write when `key` is chosen for Q1. */
function bodyFor(md: string, keys: Record<string, string>): string {
  const block = parseQuestionOptionsBlock(md)!;
  block.questions.forEach((q) => (q.recommended = keys[q.id] ?? q.recommended));
  return composeAutoAnswerText(block).answerText;
}

function makeCase(over: Partial<AnswerCase> = {}): AnswerCase {
  return {
    transitionId: 1,
    taskId: 10,
    cause: 'question_resolved',
    answeredAt: new Date('2026-11-01T00:00:00Z'),
    metadataKind: 'execution_continuation',
    selections: null,
    questionBefore: MD1,
    answerText: null,
    ...over,
  };
}
const sel = (k: string | null, id = 'Q1') => [{ questionId: id, selectedKey: k }];

describe('judgeCase: the four judgements', () => {
  it('match', () => {
    const [u] = judgeCase(makeCase({ selections: sel('A') }));
    expect(u).toMatchObject({ outcome: 'match', selectionSource: 'selections' });
  });
  it('mismatch', () => {
    const [u] = judgeCase(makeCase({ selections: sel('B') }));
    expect(u.outcome).toBe('mismatch');
  });
  it.each(['', 'Z'])('推奨案が空または選択肢にない: %s', (recommended) => {
    const md = questionMd([{ id: 'Q1', recommended, options: OPTS }]);
    const [u] = judgeCase(makeCase({ questionBefore: md, selections: sel('A') }));
    expect(u).toMatchObject({ outcome: 'excluded', reason: 'no_recommended' });
    const report = aggregateAgreement([makeCase({ questionBefore: md, selections: sel('A') })], 0);
    expect(report.answers).toEqual({
      total: 1,
      counted: 0,
      excluded: { total: 1, byReason: { no_recommended: 1 } },
    });
  });
  it.each([
    ['', 'no_selection'],
    ['ok, proceed', 'selection_not_in_options'],
  ])('no selection in the body %j: %s', (answerText, reason) => {
    const [u] = judgeCase(makeCase({ answerText }));
    expect(u).toMatchObject({ outcome: 'excluded', reason });
  });
  it('selections key not among options: selection_not_in_options', () => {
    const [u] = judgeCase(makeCase({ selections: sel('Z') }));
    expect(u.reason).toBe('selection_not_in_options');
  });
  it('null selectedKey falls through to the body', () => {
    const [u] = judgeCase(
      makeCase({ selections: sel(null), answerText: bodyFor(MD1, { Q1: 'A' }) }),
    );
    expect(u).toMatchObject({ outcome: 'match', selectionSource: 'label' });
  });
  it('body error is scored from selections but excluded with its own reason without them', () => {
    const answerError = 'answer_version_ambiguous' as const;
    const [scored] = judgeCase(makeCase({ answerError, selections: sel('A') }));
    expect(scored.outcome).toBe('match');
    const [dropped] = judgeCase(makeCase({ answerError }));
    expect(dropped.reason).toBe('answer_version_ambiguous');
  });
  it('an ambiguous pre is excluded even when selections exist', () => {
    const c = makeCase({ questionBefore: null, versionError: 'answer_version_ambiguous' });
    expect(judgeCase({ ...c, selections: sel('A') })[0].reason).toBe('answer_version_ambiguous');
  });
  it('selections that name an unknown question: unknown_question', () => {
    const units = judgeCase(makeCase({ selections: [...sel('A'), ...sel('A', 'Q9')] }));
    expect(units.map((u) => [u.questionId, u.reason ?? u.outcome])).toEqual([
      ['Q1', 'match'],
      ['Q9', 'unknown_question'],
    ]);
  });
});

describe('judgeCase: restoring from the answer body (label forms)', () => {
  it('restores every option from composeAutoAnswerText output (consequence suffix)', () => {
    for (const [key, outcome] of [
      ['A', 'match'],
      ['B', 'mismatch'],
    ] as const) {
      const [u] = judgeCase(makeCase({ answerText: bodyFor(MD1, { Q1: key }) }));
      expect(u).toMatchObject({ outcome, selectionSource: 'label' });
    }
  });
  it.each([
    ['a label that itself contains parentheses', '## Q1: s\n選択: skip it (soft)', 'mismatch'],
    ['an edited consequence text', '## Q1: s\n選択: adopt it（影響: edited later）', 'match'],
  ])('restores %s', (_name, answerText, outcome) => {
    expect(judgeCase(makeCase({ answerText }))[0].outcome).toBe(outcome);
  });
  it('does not guess when the label is not an exact match', () => {
    const [u] = judgeCase(makeCase({ answerText: '## Q1: s\n選択: do not adopt it' }));
    expect(u).toMatchObject({ outcome: 'excluded', reason: 'selection_not_in_options' });
  });
  it('maps sections to questions by id, one unit per question', () => {
    const md = questionMd([
      { id: 'Q1', recommended: 'A', options: OPTS },
      { id: 'Q2', recommended: 'B', options: OPTS },
      { id: 'Q3', recommended: 'A', options: OPTS },
    ]);
    // Q2 section is reordered first and Q3 has no section at all.
    const answerText = `${bodyFor(md, { Q2: 'A' }).split('\n\n')[1]}\n\n${bodyFor(md, { Q1: 'A' }).split('\n\n')[0]}`;
    const units = judgeCase(makeCase({ questionBefore: md, answerText }));
    expect(units.map((u) => [u.questionId, u.reason ?? u.outcome])).toEqual([
      ['Q1', 'match'],
      ['Q2', 'mismatch'],
      ['Q3', 'no_selection'],
    ]);
  });
  it('spec_change kind comes from the intake cause', () => {
    const [u] = judgeCase(
      makeCase({ cause: 'intake_question_answered', metadataKind: null, selections: sel('A') }),
    );
    expect(u.kind).toBe('spec_change');
  });
});

describe('aggregateAgreement', () => {
  const md2 = questionMd([{ id: 'Q1', recommended: 'B', options: OPTS }]);
  const mdOp = questionMd(
    [
      {
        id: 'Q1',
        recommended: 'A',
        options: [
          { key: 'A', label: 'x', requiresOperatorAction: true },
          { key: 'B', label: 'y' },
        ],
      },
    ],
    'completion_confirmation',
  );
  const mdMulti = questionMd([
    { id: 'Q1', recommended: 'A', options: OPTS },
    { id: 'Q2', recommended: 'A', options: OPTS },
  ]);
  const cases: AnswerCase[] = [
    makeCase({ transitionId: 1, selections: sel('A') }), // match, plain
    makeCase({ transitionId: 2, selections: sel('B') }), // mismatch, plain; chose a gate-mutating option
    makeCase({ transitionId: 3, questionBefore: md2, selections: sel('B') }), // match, recommended mutatesGate
    makeCase({ transitionId: 4, questionBefore: mdOp, metadataKind: null, selections: sel('B') }), // mismatch, operator action, kind from block
    makeCase({ transitionId: 5, answerText: '' }), // answer excluded (no_selection)
    makeCase({ transitionId: 6, questionBefore: null }), // answer excluded (no_prior_version)
    makeCase({ transitionId: 7, questionBefore: mdMulti, selections: sel('A') }), // Q1 match, Q2 excluded: answer counted
    makeCase({
      transitionId: 8,
      cause: 'intake_question_answered',
      metadataKind: null,
      selections: sel('A'),
    }), // spec_change match
  ];
  const report = aggregateAgreement(cases, 3);
  it('keeps counted + excluded equal to the total at both layers', () => {
    expect(report.answers).toEqual({
      total: 8,
      counted: 6,
      excluded: { total: 2, byReason: { no_selection: 1, no_prior_version: 1 } },
    });
    expect(report.questions.total).toBe(9);
    expect(report.questions.counted).toBe(6);
    expect(report.questions.excluded.total).toBe(3);
    expect(report.questions.excluded.byReason).toEqual({
      no_selection: 1,
      no_prior_version: 1,
      answer_body_unrecoverable: 1, // Q2 of case 7: no selections entry and no answer body
    });
    expect(report.outOfScope).toBe(3);
  });
  it('aggregates by kind with rates', () => {
    expect(report.byKind.execution_continuation).toEqual({ total: 4, matched: 3, rate: 3 / 4 });
    expect(report.byKind.completion_confirmation).toEqual({ total: 1, matched: 0, rate: 0 });
    expect(report.byKind.spec_change).toEqual({ total: 1, matched: 1, rate: 1 });
  });
  it('aggregates by the marks on the recommended option, both sides', () => {
    expect(report.byMutatesGate.with).toEqual({ total: 1, matched: 1, rate: 1 });
    expect(report.byMutatesGate.without).toEqual({ total: 5, matched: 3, rate: 3 / 5 });
    expect(report.byRequiresOperatorAction.with).toEqual({ total: 1, matched: 0, rate: 0 });
    expect(report.byRequiresOperatorAction.without).toEqual({ total: 5, matched: 4, rate: 4 / 5 });
  });
  it('also reports the marks on the option actually chosen', () => {
    expect(report.byChosenMutatesGate.with).toEqual({ total: 2, matched: 1, rate: 1 / 2 });
    expect(report.byChosenMutatesGate.without.total).toBe(4);
    expect(report.byChosenRequiresOperatorAction.with.total).toBe(0);
  });
  it('counts the selection source', () => {
    expect(report.selectionSource).toEqual({ selections: 6, key: 0, label: 0 });
  });
  it('handles zero cases without NaN', () => {
    const empty = aggregateAgreement([], 0);
    expect(empty.answers.total).toBe(0);
    expect(empty.overall).toEqual({ total: 0, matched: 0, rate: null });
    expect(empty.byMutatesGate.with.rate).toBeNull();
  });
});

it('全10理由の件数と二層会計を固定データで確認する', () => {
  const noRec = questionMd([{ id: 'Q1', recommended: '', options: OPTS }]);
  const duplicate = questionMd([
    { id: 'Q1', recommended: 'A', options: OPTS.map((o) => ({ ...o, label: '同一' })) },
  ]);
  const conflict = questionMd([
    {
      id: 'Q1',
      recommended: 'A',
      options: [
        { key: 'A', label: 'x' },
        { key: 'B', label: 'A 案を採用' },
      ],
    },
  ]);
  const cases = [
    makeCase({ questionBefore: null }),
    makeCase({ versionError: 'answer_version_ambiguous' }),
    makeCase({ questionBefore: '本文のみ' }),
    makeCase(),
    makeCase({ questionBefore: noRec }),
    makeCase({ answerText: '' }),
    makeCase({ selections: sel('Z') }),
    makeCase({ questionBefore: duplicate, answerText: '## Q1: s\n選択: 同一' }),
    makeCase({ selections: [...sel('A'), ...sel('A', 'Q9')] }),
    makeCase({ selections: sel('B') }),
    makeCase({ questionBefore: conflict, answerText: '## Q1: s\n選択: A 案を採用' }),
  ].map((c, transitionId) => ({ ...c, transitionId }));
  const reasons = {
    no_prior_version: 1,
    answer_version_ambiguous: 1,
    no_options_block: 1,
    answer_body_unrecoverable: 1,
    no_recommended: 1,
    no_selection: 1,
    selection_not_in_options: 1,
    ambiguous_label: 1,
    selection_ambiguous: 1,
  };
  const r = aggregateAgreement(cases, 0);
  expect(r.answers).toEqual({ total: 11, counted: 2, excluded: { total: 9, byReason: reasons } });
  expect(r.questions).toEqual({
    total: 12,
    counted: 2,
    excluded: { total: 10, byReason: { ...reasons, unknown_question: 1 } },
  });
  expect(r.overall).toEqual({ total: 2, matched: 1, rate: 0.5 });
  const empty = formatAgreementReport(aggregateAgreement([], 0));
  for (const reason of [...Object.keys(reasons), 'unknown_question']) {
    expect(empty.match(new RegExp(`^\\s+${reason}\\s+0$`, 'gm'))).toHaveLength(2);
    expect(formatAgreementReport(r)).toContain(reason);
  }
});

it('the scoring module imports no prisma', () => {
  const src = readFileSync(new URL('./supervisor-agreement-scoring.ts', import.meta.url), 'utf8');
  const imports = src.split('\n').filter((l) => /^\s*import\b|from\s+['"]/.test(l));
  expect(imports.join('\n')).not.toMatch(/prisma|database/i);
});
