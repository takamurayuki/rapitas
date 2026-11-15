/**
 * task-spec-requirements
 *
 * What a task must say before an agent starts on it (#1555): the goals, at
 * least one completion criterion (what the agent checks, or what only the
 * person checks), and the deliverable. Applies to development themes only —
 * the ones agents run; a personal errand needs none of it. Pure. Not
 * responsible for pausing the task (the intake gate does) or for how a
 * criterion is worded (`assistant/criteria-rules.ts`).
 */
import { parseSpecArray } from '../intake/spec-quality-checker';

/** What finishing a task hands over. */
export const DELIVERABLES = ['pr', 'note', 'report', 'decision'] as const;

/** One of {@link DELIVERABLES}. */
export type Deliverable = (typeof DELIVERABLES)[number];

/** A required item that is missing. */
export type RequiredSpecItem = 'goals' | 'completionCriteria';

/** The stored columns this reads (JSON-array strings, arrays, or null). */
export interface RequiredSpecInput {
  goals: unknown;
  acceptanceCriteria: unknown;
  userAcceptanceChecks: unknown;
}

const LABELS: Record<RequiredSpecItem, string> = {
  goals: 'ゴール（終わったときに何がどうなっているか）',
  completionCriteria: '完了条件（受け入れ条件、または本人が確かめること。1件以上）',
};

/**
 * The deliverable a stored value names.
 *
 * Missing or unknown reads as a PR: tasks the system files (CI watch,
 * concerns) carry none, and a PR is what a development task hands over, so
 * they are not stopped for it.
 *
 * @param value - Stored `Task.deliverable` / 保存された成果物
 * @returns The deliverable / 成果物
 */
export function parseDeliverable(value: unknown): Deliverable {
  return typeof value === 'string' && (DELIVERABLES as readonly string[]).includes(value)
    ? (value as Deliverable)
    : 'pr';
}

/**
 * The required items a task has not written.
 *
 * @param spec - The task's spec columns / タスクの仕様
 * @returns Missing items, in the order the question lists them / 未入力の必須項目
 */
export function missingRequiredSpec(spec: RequiredSpecInput): RequiredSpecItem[] {
  const missing: RequiredSpecItem[] = [];
  if (parseSpecArray(spec.goals).length === 0) missing.push('goals');
  if (
    parseSpecArray(spec.acceptanceCriteria).length === 0 &&
    parseSpecArray(spec.userAcceptanceChecks).length === 0
  ) {
    missing.push('completionCriteria');
  }
  return missing;
}

/**
 * The question a task waits on while required items are missing.
 *
 * @param title - Task title / タスク名
 * @param missing - What is missing / 未入力の必須項目
 * @returns The question.md body / 質問の本文
 */
export function requiredSpecQuestion(title: string, missing: RequiredSpecItem[]): string {
  return [
    '# 仕様確認: 必須の項目が入力されていません',
    '',
    `タスク「${title}」は開発プロジェクトのタスクのため、エージェントが着手する前に次の項目が必要です。`,
    '',
    ...missing.map((m) => `- ${LABELS[m]}`),
    '',
    'タスクの詳細でこれらを入力してから、この質問に回答してください。入力されるまで、ワークフローは先に進みません。',
  ].join('\n');
}

/** 範囲外, 成果物 and 本人が確かめること as the API takes them (#1555). */
export interface ScopeFieldsInput {
  userAcceptanceChecks?: string[];
  /** 開始条件 in words (#1559). */
  startConditions?: string[];
  outOfScope?: string[];
  deliverable?: string;
}

/**
 * The columns to write for 範囲外 and 成果物, leaving out what was not sent.
 *
 * An empty 範囲外 list clears the column, so an edit can remove the last item.
 * An unknown deliverable is not written; the route refuses one before this.
 *
 * @param input - What the caller sent / 送られた値
 * @returns Prisma data fields / 書き込む列
 */
export function scopeFieldsForWrite(input: ScopeFieldsInput): {
  userAcceptanceChecks?: string | null;
  outOfScope?: string | null;
  startConditions?: string | null;
  deliverable?: Deliverable;
} {
  const out: {
    userAcceptanceChecks?: string | null;
    outOfScope?: string | null;
    startConditions?: string | null;
    deliverable?: Deliverable;
  } = {};
  const list = (v: string[]) => {
    const items = v.map((s) => s.trim()).filter((s) => s.length > 0);
    return items.length > 0 ? JSON.stringify(items) : null;
  };
  if (input.outOfScope !== undefined) out.outOfScope = list(input.outOfScope);
  if (input.startConditions !== undefined) out.startConditions = list(input.startConditions);
  // The person's own checks are not jury criteria: editable here without the
  // criteria revision (#1555).
  if (input.userAcceptanceChecks !== undefined) {
    out.userAcceptanceChecks = list(input.userAcceptanceChecks);
  }
  if (
    typeof input.deliverable === 'string' &&
    (DELIVERABLES as readonly string[]).includes(input.deliverable)
  ) {
    out.deliverable = input.deliverable as Deliverable;
  }
  return out;
}
