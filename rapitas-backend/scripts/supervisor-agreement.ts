#!/usr/bin/env bun
/**
 * supervisor-agreement.ts
 *
 * Read-only check of how often the recommended option in question.md matches
 * what the operator actually chose when answering on the user's behalf
 * (docs/design/rapi-supervisor.md, 正解データによる事前照合). Decides whether
 * ラピ may be trusted to answer. Only reads rows (findMany / findFirst) and hands
 * them to the pure scoring in supervisor-agreement-scoring.ts.
 *
 * Usage: bun scripts/supervisor-agreement.ts [--json]
 *
 * NOTE: With dev.js the live DB is SQLite — run with its URL, e.g.:
 *   RAPITAS_DB_PROVIDER=sqlite DATABASE_URL="file:<repo>/rapitas-desktop/.data/rapitas-dev.db" \
 *     bun scripts/supervisor-agreement.ts
 */
import { readQuestionMetadata } from '../services/workflow/question-kind-resolver';
import {
  aggregateAgreement,
  type AnswerCase,
  type VersionRow,
} from './supervisor-agreement-scoring';
import { formatAgreementReport } from './supervisor-agreement-format';

// Clock skew allowed between a transition and the archive its append caused.
const SKEW_MS = 5_000;
const MARKER = '\n\n## 回答\n';
const OPERATOR_LABEL = 'オペレーター代理回答';

/** The read-only slice of the prisma client this script is allowed to use. */
export interface ReadDb {
  workflowTransition: {
    findMany(
      args: unknown,
    ): Promise<{ id: number; taskId: number; cause: string; createdAt: Date; metadata: unknown }[]>;
  };
  workflowFileVersion: { findMany(args: unknown): Promise<VersionRow[]> };
  workflowFile: { findFirst(args: unknown): Promise<{ content: string } | null> };
}

function readSelections(raw: unknown): AnswerCase['selections'] {
  if (!Array.isArray(raw)) return null;
  const out: NonNullable<AnswerCase['selections']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.questionId !== 'string') continue;
    out.push({
      questionId: o.questionId,
      selectedKey: typeof o.selectedKey === 'string' ? o.selectedKey : null,
    });
  }
  return out.length > 0 ? out : null;
}

/** Result of locating one answer: pre, body, and why either could not be fixed. */
export type Located = Pick<
  AnswerCase,
  'questionBefore' | 'answerText' | 'versionError' | 'answerError'
>;

/**
 * Locate, for every answer of one task, the question.md just before it and the
 * appended body, by version diff. pre is the newest version archived by T+5s
 * and after the previous answer; post is the next version (else the current
 * file) and must start with pre. Anything not decidable is flagged, never guessed.
 *
 * @param versions - Archived question.md versions of the task. / 過去版
 * @param current - Current question.md, never used as pre. / 現行内容
 * @param answers - Every answer transition of the task (any source). / 全回答遷移
 * @returns Per answer id: the located pieces, or null when no pre exists. / 回答id別の結果
 */
export function locateAnswers(
  versions: VersionRow[],
  current: string | null,
  answers: { id: number; at: Date }[],
): Map<number, Located | null> {
  const ms = (d: Date) => d.getTime();
  const sorted = [...versions].sort((a, b) => ms(a.archivedAt) - ms(b.archivedAt));
  const sameTime = (v: VersionRow) =>
    sorted.filter((r) => ms(r.archivedAt) === ms(v.archivedAt)).length > 1;
  const preOf = (a: { at: Date }) => {
    const prev = Math.max(
      -Infinity,
      ...answers.filter((o) => ms(o.at) < ms(a.at)).map((o) => ms(o.at)),
    );
    const cands = sorted.filter(
      (v) => ms(v.archivedAt) <= ms(a.at) + SKEW_MS && ms(v.archivedAt) > prev,
    );
    return cands[cands.length - 1];
  };
  const pres = new Map(answers.map((a) => [a.id, preOf(a)]));
  const locate = (a: { id: number; at: Date }): Located | null => {
    const pre = pres.get(a.id);
    if (!pre) return null;
    const shared = answers.some(
      (o) => o.id !== a.id && Math.abs(ms(o.at) - ms(a.at)) <= SKEW_MS && pres.get(o.id) === pre,
    );
    if (shared || sameTime(pre)) {
      return { questionBefore: null, answerText: null, versionError: 'answer_version_ambiguous' };
    }
    const next = sorted[sorted.indexOf(pre) + 1];
    const post = next?.content ?? current;
    const rest = post != null && post.startsWith(pre.content) ? post.slice(pre.content.length) : '';
    const base = { questionBefore: pre.content, answerText: null };
    if (next && sameTime(next)) return { ...base, answerError: 'answer_version_ambiguous' };
    if (!rest.startsWith(MARKER)) return { ...base, answerError: 'answer_body_unrecoverable' };
    const body = rest.slice(MARKER.length);
    const end = body.indexOf(MARKER);
    return { ...base, answerText: end < 0 ? body : body.slice(0, end) };
  };
  return new Map(answers.map((a) => [a.id, locate(a)]));
}

/**
 * Read operator proxy answers and the question.md around each one.
 *
 * @param db - Read-only db slice. / 読み取り専用の DB
 * @returns Answers in scope, and the number of proxy answers left out of scope. / 対象の回答と対象外件数
 */
export async function collectRows(
  db: ReadDb,
): Promise<{ cases: AnswerCase[]; outOfScope: number }> {
  const transitions = await db.workflowTransition.findMany({
    where: { cause: { in: ['question_resolved', 'intake_question_answered'] } },
    select: { id: true, taskId: true, cause: true, createdAt: true, metadata: true },
    orderBy: { id: 'asc' },
  });
  const cases: AnswerCase[] = [];
  let outOfScope = 0;
  // Every answer of a task (any source) bounds the version search of the others.
  const byTask = new Map<number, typeof transitions>();
  for (const t of transitions) byTask.set(t.taskId, [...(byTask.get(t.taskId) ?? []), t]);
  for (const [taskId, rows] of byTask) {
    const proxy = rows.filter((t) => {
      const label = readQuestionMetadata(t.metadata).sourceLabel;
      // Answers by anyone else are not proxy answers: counted, never scored.
      if (label !== OPERATOR_LABEL) outOfScope += 1;
      return label === OPERATOR_LABEL;
    });
    if (proxy.length === 0) continue;
    const versions = await db.workflowFileVersion.findMany({
      where: { taskId, fileType: 'question' },
      select: { content: true, archivedAt: true },
      orderBy: { archivedAt: 'asc' },
    });
    const current = await db.workflowFile.findFirst({
      where: { taskId, fileType: 'question' },
      select: { content: true },
    });
    const located = locateAnswers(
      versions,
      current?.content ?? null,
      rows.map((t) => ({ id: t.id, at: t.createdAt })),
    );
    for (const t of proxy) {
      const meta = readQuestionMetadata(t.metadata);
      const found = located.get(t.id);
      cases.push({
        transitionId: t.id,
        taskId,
        cause: t.cause,
        answeredAt: t.createdAt,
        metadataKind: typeof meta.kind === 'string' ? meta.kind : null,
        selections: readSelections(meta.selections),
        questionBefore: found?.questionBefore ?? null,
        answerText: found?.answerText ?? null,
        versionError: found?.versionError,
        answerError: found?.answerError,
      });
    }
  }
  cases.sort((x, y) => x.transitionId - y.transitionId);
  return { cases, outOfScope };
}

async function main(): Promise<void> {
  // JSON標準出力に接続ログが混ざらないよう、ロガーの初期化より前に抑制する。
  // 読み取り失敗の詳細は入口のcatchから標準エラーへ出力する。
  if (process.argv.includes('--json')) process.env.LOG_LEVEL = 'silent';
  // Imported lazily so the module can be loaded by tests without opening a DB connection.
  const { prisma } = await import('../config/database');
  const { cases, outOfScope } = await collectRows(prisma as unknown as ReadDb);
  const report = aggregateAgreement(cases, outOfScope);
  console.log(
    process.argv.includes('--json')
      ? JSON.stringify(report, null, 2)
      : formatAgreementReport(report),
  );
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[supervisor-agreement] failed:', err);
      process.exit(1);
    });
}
