/**
 * supervisor-agreement-scoring
 *
 * 代理回答と推奨案の照合を、DB非依存の固定行データで判定・集計する。
 */
import {
  parseQuestionOptionsBlock,
  type ParsedQuestion,
} from '../services/workflow/question-options-parser';
import { resolveExplicitOrDefaultKind } from '../services/workflow/question-kind-resolver';
import { restoreFromBody } from './supervisor-agreement-selection';

/** One superseded question.md version. / question.md の過去版 */
export interface VersionRow {
  content: string;
  archivedAt: Date;
}

/** Everything known about one operator proxy answer (one transition). */
export interface AnswerCase {
  transitionId: number;
  taskId: number;
  /** `question_resolved` or `intake_question_answered`. */
  cause: string;
  answeredAt: Date;
  metadataKind: string | null;
  selections: { questionId: string; selectedKey: string | null }[] | null;
  /** question.md as it was just before the answer; null when no version was found. */
  questionBefore: string | null;
  /** The appended answer text; null when it cannot be recovered. */
  answerText: string | null;
  /** pre cannot be fixed: excluded even when selections exist. / 回答前の版が確定できない */
  versionError?: 'answer_version_ambiguous';
  /** pre is fixed but the body is not: selections can still score it. / 本文が確定できない */
  answerError?: 'answer_version_ambiguous' | 'answer_body_unrecoverable';
}

/** Closed set: every question unit ends as match, mismatch or one of these. */
export const EXCLUSION_REASONS = [
  'no_prior_version',
  'answer_version_ambiguous',
  'no_options_block',
  'answer_body_unrecoverable',
  'no_recommended',
  'no_selection',
  'selection_not_in_options',
  'ambiguous_label',
  'selection_ambiguous',
  'unknown_question',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** The judgement for one question of one answer. / 質問ごとの判定 */
export interface AgreementUnit {
  transitionId: number;
  questionId: string | null;
  kind: string;
  outcome: 'match' | 'mismatch' | 'excluded';
  reason?: ExclusionReason;
  selectionSource?: 'selections' | 'key' | 'label';
  /** Marks of the RECOMMENDED option. / 推奨案の印 */
  mutatesGate?: boolean;
  requiresOperatorAction?: boolean;
  /** Marks of the option actually chosen. / 選ばれた選択肢の印 */
  chosenMutatesGate?: boolean;
  chosenRequiresOperatorAction?: boolean;
}

/** Count and agreement rate; `rate` is null when `total` is 0. */
export interface Bucket {
  total: number;
  matched: number;
  rate: number | null;
}
interface Ledger {
  total: number;
  counted: number;
  excluded: { total: number; byReason: Partial<Record<ExclusionReason, number>> };
}
interface Split {
  with: Bucket;
  without: Bucket;
}

export interface AgreementReport {
  /** Main accounting: one entry per operator proxy answer (transition). */
  answers: Ledger;
  /** Side accounting: one entry per question inside those answers. */
  questions: Ledger;
  /** Answers that are not operator proxy answers, counted only. / 代理でない回答数 */
  outOfScope: number;
  overall: Bucket;
  byKind: Record<string, Bucket>;
  byMutatesGate: Split;
  byRequiresOperatorAction: Split;
  byChosenMutatesGate: Split;
  byChosenRequiresOperatorAction: Split;
  selectionSource: { selections: number; key: number; label: number };
}

type Restored =
  | { key: string; source: 'selections' | 'key' | 'label' }
  | { reason: ExclusionReason };

function restoreSelection(q: ParsedQuestion, c: AnswerCase, multi: boolean): Restored {
  const fromMeta = c.selections?.find((s) => s.questionId === q.id)?.selectedKey;
  if (fromMeta) return { key: fromMeta, source: 'selections' };
  if (c.answerText === null) return { reason: c.answerError ?? 'answer_body_unrecoverable' };
  return restoreFromBody(q, c.answerText, multi);
}

/**
 * 質問単位で判定する。質問を読めない場合は回答全体を1件の除外として返す。
 *
 * @param c - 回答と対応づけた質問・本文
 * @returns 空配列にはならない質問単位の判定
 */
export function judgeCase(c: AnswerCase): AgreementUnit[] {
  const explicit = c.metadataKind;
  const kindOf = (fromBlock?: string) =>
    c.cause === 'intake_question_answered'
      ? 'spec_change'
      : resolveExplicitOrDefaultKind({
          cause: 'question_resolved',
          explicitKind: explicit ?? fromBlock,
          currentStatus: null,
        });
  const whole = (kind: string, reason: ExclusionReason): AgreementUnit[] => [
    { transitionId: c.transitionId, questionId: null, kind, outcome: 'excluded', reason },
  ];
  if (c.versionError) return whole(kindOf(), c.versionError);
  if (c.questionBefore === null) return whole(kindOf(), 'no_prior_version');
  const block = parseQuestionOptionsBlock(c.questionBefore);
  const kind = kindOf(block?.kind);
  if (!block) return whole(kind, 'no_options_block');

  const base = { transitionId: c.transitionId, kind };
  const units = block.questions.map((q): AgreementUnit => {
    const u = { ...base, questionId: q.id };
    const rec = q.options.find((o) => o.key === q.recommended);
    if (!rec) return { ...u, outcome: 'excluded', reason: 'no_recommended' };
    const r = restoreSelection(q, c, block.questions.length > 1);
    if ('reason' in r) return { ...u, outcome: 'excluded', reason: r.reason };
    const chosen = q.options.find((o) => o.key === r.key);
    if (!chosen) {
      return { ...u, outcome: 'excluded', reason: 'selection_not_in_options' };
    }
    return {
      ...u,
      outcome: chosen.key === rec.key ? 'match' : 'mismatch',
      selectionSource: r.source,
      mutatesGate: rec.mutatesGate === true,
      requiresOperatorAction: rec.requiresOperatorAction === true,
      chosenMutatesGate: chosen.mutatesGate === true,
      chosenRequiresOperatorAction: chosen.requiresOperatorAction === true,
    };
  });
  const known = new Set(block.questions.map((q) => q.id));
  for (const s of c.selections ?? []) {
    if (!known.has(s.questionId)) {
      units.push({
        ...base,
        questionId: s.questionId,
        outcome: 'excluded',
        reason: 'unknown_question',
      });
    }
  }
  return units;
}

function bucket(units: AgreementUnit[]): Bucket {
  const total = units.length;
  const matched = units.filter((u) => u.outcome === 'match').length;
  return { total, matched, rate: total === 0 ? null : matched / total };
}

function split(units: AgreementUnit[], flag: (u: AgreementUnit) => boolean | undefined): Split {
  return {
    with: bucket(units.filter((u) => flag(u))),
    without: bucket(units.filter((u) => !flag(u))),
  };
}

function ledger(total: number, reasons: (ExclusionReason | undefined)[]): Ledger {
  const byReason: Partial<Record<ExclusionReason, number>> = {};
  for (const r of reasons) if (r) byReason[r] = (byReason[r] ?? 0) + 1;
  const excluded = reasons.length;
  // The invariant the report promises: nothing is dropped between counted and excluded.
  return { total, counted: total - excluded, excluded: { total: excluded, byReason } };
}

/**
 * 回答を集計し、回答単位と質問単位で対象数と除外数の等式を検査する。
 * @param cases - Operator proxy answers in scope. / 対象の代理回答
 * @param outOfScope - Non-proxy answers, counted only. / 対象外の件数
 * @returns The report; at both layers counted + excluded equals total. / 集計結果
 */
export function aggregateAgreement(cases: AnswerCase[], outOfScope: number): AgreementReport {
  const perAnswer = cases.map(judgeCase);
  const all = perAnswer.flat();
  const counted = all.filter((u) => u.outcome !== 'excluded');
  // An answer is excluded only when none of its questions could be judged.
  const excludedAnswers = perAnswer.filter((us) => us.every((u) => u.outcome === 'excluded'));
  const report: AgreementReport = {
    answers: ledger(
      cases.length,
      excludedAnswers.map((us) => us[0].reason),
    ),
    questions: ledger(
      all.length,
      all.filter((u) => u.outcome === 'excluded').map((u) => u.reason),
    ),
    outOfScope,
    overall: bucket(counted),
    byKind: {},
    byMutatesGate: split(counted, (u) => u.mutatesGate),
    byRequiresOperatorAction: split(counted, (u) => u.requiresOperatorAction),
    byChosenMutatesGate: split(counted, (u) => u.chosenMutatesGate),
    byChosenRequiresOperatorAction: split(counted, (u) => u.chosenRequiresOperatorAction),
    selectionSource: {
      selections: counted.filter((u) => u.selectionSource === 'selections').length,
      key: counted.filter((u) => u.selectionSource === 'key').length,
      label: counted.filter((u) => u.selectionSource === 'label').length,
    },
  };
  const kinds = ['execution_continuation', 'completion_confirmation', 'spec_change'];
  for (const k of new Set([...kinds, ...counted.map((u) => u.kind)])) {
    report.byKind[k] = bucket(counted.filter((u) => u.kind === k));
  }
  for (const l of [report.answers, report.questions]) {
    if (l.counted + l.excluded.total !== l.total) throw new Error('agreement accounting mismatch');
  }
  return report;
}
