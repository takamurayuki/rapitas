/**
 * Intake Contamination Gate
 *
 * The coherence half of the intake gate: detecting acceptance criteria that
 * carry another task's vocabulary or the supervisor/verifier's own
 * investigation scratch path (`.supervisor/...`), pausing for a two-choice
 * confirmation, and — for the investigation-artifact path only — applying the
 * recorded A/B decision (keep vs. remove) once answered.
 *
 * Split out of intake-gate.ts (task 909) purely to stay under the
 * COMPONENT_SPLITTING_POLICY.md hard line-limit; ensureIntakeReady() in
 * intake-gate.ts remains the sole caller and public entry point.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, writeWorkflowFile } from '../workflow/workflow-file-utils';
import { recordTransition } from '../workflow/transition-recorder';
import {
  extractReferencedTaskIds,
  findContaminatedCriteria,
  findSupervisorArtifactCriteria,
  type ContaminatedCriterion,
} from './spec-coherence-checker';
import { parseSpecArray } from './spec-quality-checker';
import type { IntakeTaskRow } from './intake-task-row';

const log = createLogger('intake-contamination-gate');

/**
 * Criteria on this task that carry another task's subject matter.
 *
 * Only tasks this spec actually cites are considered, and never the task
 * itself — a task may legitimately quote its own title.
 *
 * The task's own text is passed through as well, because the second detection
 * path needs no lookup: a title of the form `#666「…」` carries the other
 * task's subject inside this one, and criteria drawn from that quoted span are
 * about the cited task by construction.
 *
 * A third path — criteria referencing the supervisor/verifier's own
 * investigation scratch path (`.supervisor/...`) — runs regardless of `#id`
 * references (task 906 had none), because that signal is the path itself,
 * not a citation to check.
 */
export async function findLiftedCriteria(task: IntakeTaskRow): Promise<ContaminatedCriterion[]> {
  const criteria = parseSpecArray(task.acceptanceCriteria);
  if (criteria.length === 0) return [];

  // Runs unconditionally — independent of whether this task cites another by
  // #id — because the supervisor-scratch-path signal is structural, not a
  // cross-task citation (task 909).
  const artifactHits = findSupervisorArtifactCriteria(criteria);

  const ownText = `${task.title} ${task.description ?? ''}`;
  const ids = extractReferencedTaskIds(ownText).filter((id) => id !== task.id);
  if (ids.length === 0) return artifactHits;

  const referenced = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });
  const crossTaskHits = findContaminatedCriteria(criteria, referenced, ownText);
  const flagged = new Set(artifactHits.map((h) => h.index));
  return [...artifactHits, ...crossTaskHits.filter((h) => !flagged.has(h.index))].sort(
    (a, b) => a.index - b.index,
  );
}

/**
 * Pause the task and say which criteria belong to which other task.
 *
 * Deliberately concrete: it names the criterion, the phrase, and the task the
 * phrase came from, because that is what a reader needs to decide whether to
 * rewrite the criteria or keep them. The generic 「仕様が不十分」 question would
 * not have helped here — the spec was not insufficient, it was misdirected.
 */
export async function raiseContaminationQuestion(
  task: IntakeTaskRow,
  contaminated: ContaminatedCriterion[],
  notifyIntakeQuestionPending: (params: { taskId: number; taskTitle: string }) => Promise<unknown>,
): Promise<void> {
  const resolved = await resolveWorkflowDir(task.id);
  if (!resolved) {
    log.warn(
      { taskId: task.id },
      '[intake-contamination-gate] cannot resolve workflow dir — skipping question',
    );
    return;
  }
  const hasArtifact = contaminated.some((c) => c.kind === 'investigation_artifact');
  const hasCrossTask = contaminated.some((c) => c.kind !== 'investigation_artifact');
  const lines = ['# 仕様確認: 受入基準の内容を確認してください', ''];
  if (hasCrossTask) {
    lines.push(
      `タスク「${task.title}」の受入基準に、参照している別タスクが導入した用語がそのまま現れています。`,
      'ゴールアンカー生成が観測元タスクの内容を取り込んだ可能性があります。',
    );
  }
  if (hasArtifact) {
    lines.push(
      `タスク「${task.title}」の受入基準に、監督/検証者自身の調査記録・専用ファイル（.supervisor/ 配下）への言及がそのまま含まれています。`,
      '調査時の再現手順・監督用スクラッチファイルの記述は、このタスクの実装義務ではありません。',
    );
  }
  lines.push('', '## 該当する受入基準', '');
  for (const c of contaminated) {
    lines.push(`- 受入基準${c.index}: ${c.criterion}`);
    lines.push(
      c.sourceTaskId != null
        ? `  - タスク #${c.sourceTaskId} の用語: ${c.phrases.map((p) => `「${p}」`).join(' ')}`
        : `  - 監督/検証者自身の調査記録パスへの言及: ${c.phrases.map((p) => `「${p}」`).join(' ')}`,
    );
  }
  if (hasCrossTask) {
    lines.push(
      '',
      '## 別タスク由来の基準について判断してください',
      '',
      `- **A: 受入基準はこのタスクのものではない** — 基準を書き直してください。このタスク（${task.title}）が実際に達成すべきことを基準にします`,
      '- **B: 受入基準は正しい** — 参照タスクと同じ用語を使うのが妥当な場合はこちらを選んでください。このまま実行します',
      '',
      'A の場合、受入基準を訂正してから回答してください（訂正すると修復予算もリセットされます）。',
    );
  }
  // 監督/検証者自身の調査記録パスへの言及は、削除するか保持するかを二択で確定
  // させる（一次防御 task-spec-deriver.ts は task 909 の再計画で無条件削除を
  // 撤回した — この質問だけが acceptanceCriteria を書き換える唯一の場所）。
  // ここで questionId (`ia<index>`) を割り振り、回答時の json:options selections
  // でどちらを選んだかを applyContaminationDecisions が突き合わせる。
  const artifactCriteria = contaminated.filter((c) => c.kind === 'investigation_artifact');
  if (artifactCriteria.length > 0) {
    lines.push('', '## 監督/検証者自身の調査記録パスへの言及について判断してください', '');
    for (const c of artifactCriteria) {
      lines.push(
        `- 受入基準${c.index}「${c.criterion}」`,
        '  - A: この基準は正当な要求である（そのまま保持する）',
        '  - B: 監督/検証者の調査記録が誤って混入したものである（除去する）',
      );
    }
    lines.push(
      '',
      'A を選ぶと当該基準は一切変更されません。B を選ぶと当該基準のみが受入基準から除去されます（他の基準は変更されません）。',
    );

    const optionsBlock = {
      questions: artifactCriteria.map((c) => ({
        id: `ia${c.index}`,
        summary: `受入基準${c.index}の扱い`,
        options: [
          {
            key: 'A',
            label: 'この基準は正当な要求である（保持する）',
            consequence: '当該基準は一切変更しません',
          },
          {
            key: 'B',
            label: '調査記録の混入である（除去する）',
            consequence: '当該基準のみを受入基準から除去します',
          },
        ],
        freeTextRequired: false,
        freeTextReason: null,
        recommended: 'B',
        recommendedReason:
          '.supervisor/ はバックエンドコードから一切参照されない監督専用スクラッチパスであり(research.md前提監査#4)、既定は調査記録として扱う。ただし明示的にそのパスを対象とする正当な要求であれば A を選ぶこと。',
      })),
    };
    lines.push('', '```json:options', JSON.stringify(optionsBlock), '```');
  }
  await writeWorkflowFile(task.id, 'question', lines.join('\n'));

  const fromStatus = task.workflowStatus ?? 'draft';
  await prisma.task.update({
    where: { id: task.id },
    data: { workflowStatus: 'awaiting_question', updatedAt: new Date() },
  });
  await recordTransition({
    taskId: task.id,
    fromStatus,
    toStatus: 'awaiting_question',
    actor: 'system',
    cause: 'intake_question',
    phase: 'question',
    metadata: {
      previousStatus: fromStatus,
      reason: 'criteria_contamination',
      criteria: contaminated.map((c) => c.index),
      sourceTaskIds: [
        ...new Set(
          contaminated.map((c) => c.sourceTaskId).filter((id): id is number => id != null),
        ),
      ],
      investigationArtifactCriteria: artifactCriteria.map((c) => c.index),
    },
  });
  await notifyIntakeQuestionPending({ taskId: task.id, taskTitle: task.title }).catch(() => {});
}

/** One structured selection recorded on `intake_question_answered` (from a json:options-driven UI answer). */
interface RecordedSelection {
  questionId: string;
  selectedKey: string | null;
}

/**
 * The structured selections from the task's most recent
 * `intake_question_answered` transition, if any were recorded. Empty when the
 * user typed a freeform answer instead of picking a `json:options` button —
 * that ambiguity is the caller's signal to change nothing (see
 * {@link applyContaminationDecisions}).
 */
async function getAnsweredSelections(taskId: number): Promise<RecordedSelection[]> {
  const row = await prisma.workflowTransition
    .findFirst({
      where: { taskId, cause: 'intake_question_answered' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    })
    .catch(() => null);
  if (!row) return [];
  try {
    const meta = JSON.parse((row as { metadata: string | null }).metadata ?? '{}') as {
      selections?: unknown;
    };
    if (!Array.isArray(meta.selections)) return [];
    return meta.selections
      .filter(
        (s): s is RecordedSelection =>
          !!s && typeof s === 'object' && typeof (s as RecordedSelection).questionId === 'string',
      )
      .map((s) => ({
        questionId: s.questionId,
        selectedKey: typeof s.selectedKey === 'string' ? s.selectedKey : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Apply a previously-recorded A/B decision (from {@link raiseContaminationQuestion}'s
 * `json:options` block, questionId `ia<index>`) to investigation-artifact
 * criteria: `B` removes exactly that criterion from acceptanceCriteria; `A` or
 * no recorded selection at all leaves acceptanceCriteria untouched (AC#2 —
 * an explicit criterion is never silently dropped on an ambiguous signal).
 * Runs at most once per criterion in practice: once removed, it is no longer
 * present in `contaminated` on the next call, so re-application is a no-op.
 *
 * @param task - The task row (read-only; caller persists the new acceptanceCriteria on the returned copy). / タスク
 * @param contaminated - This run's coherence findings. / 汚染検出結果
 * @returns Removed criterion texts, the remaining findings, and — when anything was removed — the persisted acceptanceCriteria JSON. / 適用結果
 */
export async function applyContaminationDecisions(
  task: IntakeTaskRow,
  contaminated: ContaminatedCriterion[],
): Promise<{
  removed: string[];
  remainingContaminated: ContaminatedCriterion[];
  acceptanceCriteriaJson: string;
}> {
  const artifactCriteria = contaminated.filter((c) => c.kind === 'investigation_artifact');
  if (artifactCriteria.length === 0) {
    return {
      removed: [],
      remainingContaminated: contaminated,
      acceptanceCriteriaJson: JSON.stringify(parseSpecArray(task.acceptanceCriteria)),
    };
  }

  const selections = await getAnsweredSelections(task.id).catch(() => []);
  const toRemove = new Set<string>();
  for (const c of artifactCriteria) {
    const pick = selections.find((s) => s.questionId === `ia${c.index}`)?.selectedKey;
    if (pick === 'B') toRemove.add(c.criterion);
    // pick === 'A', or no recorded selection: leave this criterion untouched.
  }

  const currentCriteria = parseSpecArray(task.acceptanceCriteria);
  if (toRemove.size === 0) {
    return {
      removed: [],
      remainingContaminated: contaminated,
      acceptanceCriteriaJson: JSON.stringify(currentCriteria),
    };
  }

  const nextCriteria = currentCriteria.filter((item) => !toRemove.has(item));
  await prisma.task.update({
    where: { id: task.id },
    data: { acceptanceCriteria: JSON.stringify(nextCriteria), updatedAt: new Date() },
  });
  await recordTransition({
    taskId: task.id,
    fromStatus: task.workflowStatus ?? null,
    toStatus: task.workflowStatus ?? 'draft',
    actor: 'system',
    cause: 'intake_contamination_resolved',
    phase: 'research',
    metadata: { removed: [...toRemove] },
  });

  return {
    removed: [...toRemove],
    remainingContaminated: contaminated.filter((c) => !toRemove.has(c.criterion)),
    acceptanceCriteriaJson: JSON.stringify(nextCriteria),
  };
}
