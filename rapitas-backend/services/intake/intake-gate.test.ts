/**
 * intake-gate.test
 *
 * Unit tests for ensureIntakeReady's orchestration: the three outcomes
 * (ready / awaiting_question / proceed_low_confidence), the enrichment
 * short-circuit, and idempotency when no task is found. Pure decision logic
 * (checkSpecQuality, decideIntake) is already covered by
 * spec-quality-checker.test.ts / intake-policy.test.ts — this file only
 * verifies the gate wires them together correctly. All I/O (prisma, workflow
 * files, AI derivation, notifications) is mocked at the module boundary
 * BEFORE the module under test is imported, so this never touches the
 * database or spawns an AI call.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const taskFindUnique = mock(() =>
  Promise.resolve({
    id: 1,
    title: 'Some task',
    description: null,
    goals: null,
    constraints: null,
    acceptanceCriteria: null,
    workflowStatus: 'draft',
  }),
);
const taskUpdate = mock(() => Promise.resolve({}));
const transitionFindFirst = mock(() => Promise.resolve(null));

// Referenced tasks, fetched by the coherence check.
const taskFindMany = mock((): Promise<{ id: number; title: string }[]> => Promise.resolve([]));
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/wf/1' }));
const readWorkflowFile = mock(() => Promise.resolve(null));
const writeWorkflowFile = mock(() => Promise.resolve('/wf/1/question.md'));
const recordTransition = mock(() => Promise.resolve());
const deriveTaskSpec = mock(() =>
  Promise.resolve({
    spec: { goals: [], constraints: [], acceptanceCriteria: [] },
    source: 'empty',
  }),
);
const generateIntakeQuestions = mock(() => Promise.resolve([]));
const createNotification = mock(() => Promise.resolve());
const notifyIntakeQuestionPending = mock(() => Promise.resolve<unknown>({ id: 1 }));

mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, findMany: taskFindMany },
    workflowTransition: { findFirst: transitionFindFirst },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));
mock.module('../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir,
  readWorkflowFile,
  writeWorkflowFile,
}));
mock.module('../workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../task/task-spec-deriver', () => ({
  deriveTaskSpec,
  generateIntakeQuestions,
}));
mock.module('../communication/notification-service', () => ({
  createNotification,
  notifyIntakeQuestionPending,
}));

const { ensureIntakeReady } = await import('./intake-gate');

/** An adequate spec: goals(40) + acceptanceCriteria(40) = 80 >= ADEQUATE_SCORE(70). */
const ADEQUATE_TASK = {
  id: 1,
  title: 'Adequate task',
  description: 'x'.repeat(60),
  goals: JSON.stringify(['Do the thing']),
  constraints: null,
  acceptanceCriteria: JSON.stringify(['It works']),
  workflowStatus: 'draft',
};

/** A thin spec: no goals/constraints/acceptanceCriteria, short description. */
const THIN_TASK = {
  id: 1,
  title: 'Thin task',
  description: 'short',
  goals: null,
  constraints: null,
  acceptanceCriteria: null,
  workflowStatus: 'draft',
};

describe('ensureIntakeReady', () => {
  beforeEach(() => {
    taskFindUnique.mockReset();
    taskUpdate.mockReset().mockResolvedValue({});
    transitionFindFirst.mockReset().mockResolvedValue(null);
    resolveWorkflowDir.mockReset().mockResolvedValue({ dir: '/wf/1' });
    readWorkflowFile.mockReset().mockResolvedValue(null);
    writeWorkflowFile.mockReset().mockResolvedValue('/wf/1/question.md');
    recordTransition.mockReset().mockResolvedValue(undefined);
    deriveTaskSpec.mockReset().mockResolvedValue({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'empty',
    });
    generateIntakeQuestions.mockReset().mockResolvedValue([]);
    createNotification.mockReset().mockResolvedValue(undefined);
    notifyIntakeQuestionPending.mockReset().mockResolvedValue({ id: 1 });
    delete process.env.RAPITAS_INTAKE_ASK_WHEN_AMBIGUOUS;
  });

  it('returns ready immediately for a task the gate cannot find (defensive no-op)', async () => {
    taskFindUnique.mockResolvedValue(null);
    const r = await ensureIntakeReady(999);
    expect(r).toEqual({ status: 'ready' });
    expect(deriveTaskSpec).not.toHaveBeenCalled();
  });

  it('returns ready without touching enrichment/questions when the spec is already adequate', async () => {
    taskFindUnique.mockResolvedValue(ADEQUATE_TASK);
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('ready');
    expect(deriveTaskSpec).not.toHaveBeenCalled();
    expect(writeWorkflowFile).not.toHaveBeenCalled();
    // 非発火正常系: no question raised → no question notification.
    expect(notifyIntakeQuestionPending).not.toHaveBeenCalled();
  });

  it('asks a clarifying question (policy=ask, default) when the spec is thin and unanswered', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    transitionFindFirst.mockResolvedValue(null); // no intake_question_answered row
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('awaiting_question');
    // question.md must be written and the task moved to awaiting_question.
    expect(writeWorkflowFile).toHaveBeenCalledTimes(1);
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('question');
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ workflowStatus: 'awaiting_question' }),
    });
    const rt = recordTransition.mock.calls[0][0] as {
      cause: string;
      toStatus: string;
      metadata: { kind?: string };
    };
    expect(rt.cause).toBe('intake_question');
    expect(rt.toStatus).toBe('awaiting_question');
    // task 902: intake questions must always carry an explicit spec_change
    // kind so the answer-question dispatcher never mistakes them for
    // execution_continuation/completion_confirmation.
    expect(rt.metadata.kind).toBe('spec_change');
    // 受入基準1: raising a question must notify — an unanswered question never
    // advances on its own (#578/#579 sat 4 days unseen without this).
    expect(notifyIntakeQuestionPending).toHaveBeenCalledTimes(1);
    expect(notifyIntakeQuestionPending).toHaveBeenCalledWith({
      taskId: 1,
      taskTitle: 'Thin task',
    });
  });

  it('does not fail the gate when the question notification rejects (best-effort)', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    notifyIntakeQuestionPending.mockRejectedValue(new Error('notification down'));
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('awaiting_question');
    expect(writeWorkflowFile).toHaveBeenCalledTimes(1);
  });

  it('proceeds on best-guess once the user has answered but the spec is still thin', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    transitionFindFirst.mockResolvedValue({ id: 42 }); // intake_question_answered exists
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('proceed_low_confidence');
    // Must NOT re-ask (no new question.md write) once answered.
    expect(writeWorkflowFile).not.toHaveBeenCalled();
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('intake_low_confidence');
    // Silent low-confidence proceed is the documented anti-pattern — must notify.
    expect(createNotification).toHaveBeenCalledTimes(1);
    // 非発火正常系: the low-confidence path must NOT emit the question notice.
    expect(notifyIntakeQuestionPending).not.toHaveBeenCalled();
  });

  it('proceeds on best-guess without asking when policy=best_guess (env)', async () => {
    process.env.RAPITAS_INTAKE_ASK_WHEN_AMBIGUOUS = 'false';
    taskFindUnique.mockResolvedValue(THIN_TASK);
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('proceed_low_confidence');
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });

  it('short-circuits to ready when enrichment grows the spec to adequate', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    deriveTaskSpec.mockResolvedValue({
      spec: {
        goals: ['Derived goal'],
        constraints: [],
        acceptanceCriteria: ['Derived acceptance criterion'],
      },
      source: 'ai',
    });
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('ready');
    // Enriched fields must be persisted to the task.
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    const args = taskUpdate.mock.calls[0][0] as { data: { goals: string } };
    expect(JSON.parse(args.data.goals)).toEqual(['Derived goal']);
    // Enrichment success is recorded, and the gate must NOT also ask a question.
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('intake_enriched');
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });

  it('falls through to ask when enrichment runs but does not grow the spec', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    // deriveTaskSpec returns source 'ai' but with nothing new — enrichSpec's
    // `grew` check must reject this so the gate proceeds to ask/best-guess.
    deriveTaskSpec.mockResolvedValue({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'ai',
    });
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('awaiting_question');
    expect(taskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ goals: expect.anything() }),
      }),
    );
  });

  it('swallows an enrichment failure and still proceeds to ask/best-guess (non-fatal)', async () => {
    taskFindUnique.mockResolvedValue(THIN_TASK);
    deriveTaskSpec.mockRejectedValue(new Error('AI provider down'));
    const r = await ensureIntakeReady(1);
    expect(r.status).toBe('awaiting_question');
  });

  it('does not enrich (basis is empty) when there is no description and no prior answer', async () => {
    taskFindUnique.mockResolvedValue({ ...THIN_TASK, description: null });
    readWorkflowFile.mockResolvedValue(null);
    const r = await ensureIntakeReady(1);
    expect(deriveTaskSpec).not.toHaveBeenCalled();
    expect(r.status).toBe('awaiting_question');
  });
});

describe('ensureIntakeReady: 受入基準の混入検出 (task 671 実データ)', () => {
  const TITLE_662 =
    '[Idea] 確認済み修正不要完了を、修復ループ回数で「素直な修正不要」と「往復した末の修正不要」にさらに細分化する';

  /** 671 as generated: substantial criteria, all about task 662. */
  const CONTAMINATED_TASK = {
    id: 671,
    title: '[Concern] [回顧] 修復ループ: #662 で verify_repair が5回反復している',
    description: '観測元タスク #662 の修復ループを回顧する',
    workflowStatus: 'draft',
    goals: JSON.stringify(['修復ループの根本原因を特定する']),
    constraints: JSON.stringify(['既存の挙動を変えない']),
    acceptanceCriteria: JSON.stringify([
      '修復ループ0回で完了したタスクが『素直な修正不要』として区分される',
      '修復ループ1回以上で完了したタスクが『往復した末の修正不要』として区分される',
    ]),
  };

  beforeEach(() => {
    taskFindUnique.mockReset();
    taskUpdate.mockReset().mockResolvedValue({});
    taskFindMany.mockReset().mockResolvedValue([{ id: 662, title: TITLE_662 }]);
    transitionFindFirst.mockReset().mockResolvedValue(null);
    resolveWorkflowDir.mockReset().mockResolvedValue({ dir: '/wf/1' });
    writeWorkflowFile.mockReset().mockResolvedValue('/wf/1/question.md');
    recordTransition.mockReset().mockResolvedValue(undefined);
    notifyIntakeQuestionPending.mockReset().mockResolvedValue({ id: 1 });
  });

  it('厚みが足りていても、別タスクの内容なら止めて質問する', async () => {
    // 実測 2026-08-27: この仕様は checkSpecQuality を通過して実行され、
    // 差し戻し10回の末に blocked になった。厚みは十分で、対象が違った。
    taskFindUnique.mockResolvedValue(CONTAMINATED_TASK);

    const r = await ensureIntakeReady(671);

    expect(r.status).toBe('awaiting_question');
    const body = String(writeWorkflowFile.mock.calls[0]?.[2] ?? '');
    // 読み手が判断できるだけの具体性があること。
    expect(body).toContain('受入基準1');
    expect(body).toContain('素直な修正不要');
    expect(body).toContain('#662');
  });

  it('参照タスクが無ければ検査せず通す', async () => {
    taskFindMany.mockResolvedValue([]);
    taskFindUnique.mockResolvedValue({
      ...CONTAMINATED_TASK,
      title: '[Concern] 修復ループの回顧',
      description: '参照なし',
    });

    expect((await ensureIntakeReady(671)).status).toBe('ready');
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });

  it('回答済みなら再質問せず続行する（質問ループを作らない）', async () => {
    // task 363 の形: 回答しても条件が消えないと無限に問い続ける。
    transitionFindFirst.mockResolvedValue({ id: 1 });
    taskFindUnique.mockResolvedValue(CONTAMINATED_TASK);

    const r = await ensureIntakeReady(671);

    expect(r.status).toBe('ready');
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });
});

// task 906/909: 監督自身の再現調査ナラティブ（.supervisor/ 配下の監督専用スク
// ラッチパス）が deriveTaskSpec の自動抽出を経て acceptanceCriteria に混入した
// ケース。#id 引用が皆無でも検出されなければならない（研究フェーズの前提監査#2）。
describe('ensureIntakeReady: 受入基準への監督専用パス混入検出 (task 906 実データ)', () => {
  const SUPERVISOR_ARTIFACT_TASK = {
    id: 906,
    title: '[監督実測] 受入基準の抽出が調査証跡を実装義務に変換しないようにする',
    // task 906 の実際の description: #id 引用を一切含まない。
    description: '受入基準生成・plan整合・verifier入力の境界を調査し修正する。',
    workflowStatus: 'draft',
    goals: JSON.stringify(['受入基準生成の欠陥を修正する']),
    constraints: JSON.stringify(['既存の挙動を変えない']),
    acceptanceCriteria: JSON.stringify([
      '正当な受入基準',
      '再現patchは C:/Projects/rapitas/.supervisor/measurements/task906-red.patch のとおりに適用される',
    ]),
  };

  beforeEach(() => {
    taskFindUnique.mockReset();
    taskUpdate.mockReset().mockResolvedValue({});
    taskFindMany.mockReset().mockResolvedValue([]);
    transitionFindFirst.mockReset().mockResolvedValue(null);
    resolveWorkflowDir.mockReset().mockResolvedValue({ dir: '/wf/906' });
    writeWorkflowFile.mockReset().mockResolvedValue('/wf/906/question.md');
    recordTransition.mockReset().mockResolvedValue(undefined);
    notifyIntakeQuestionPending.mockReset().mockResolvedValue({ id: 1 });
  });

  it('#id 参照が皆無でも .supervisor/ 参照があれば止めて質問する', async () => {
    taskFindUnique.mockResolvedValue(SUPERVISOR_ARTIFACT_TASK);

    const r = await ensureIntakeReady(906);

    expect(r.status).toBe('awaiting_question');
    // 他タスク参照の検索（taskFindMany）は #id が無いので呼ばれない。
    expect(taskFindMany).not.toHaveBeenCalled();
    const body = String(writeWorkflowFile.mock.calls[0]?.[2] ?? '');
    expect(body).toContain('受入基準2');
    expect(body).toContain('.supervisor/');
  });

  it('.supervisor/ を含まない通常の未達受入基準では発火しない（無関係な既存失敗との区別）', async () => {
    taskFindUnique.mockResolvedValue({
      ...SUPERVISOR_ARTIFACT_TASK,
      acceptanceCriteria: JSON.stringify(['正当な受入基準1', '正当な受入基準2']),
    });

    const r = await ensureIntakeReady(906);

    expect(r.status).toBe('ready');
    expect(writeWorkflowFile).not.toHaveBeenCalled();
  });

  it('質問に json:options ブロックが含まれ、questionId が ia<index> 形式であること', async () => {
    taskFindUnique.mockResolvedValue(SUPERVISOR_ARTIFACT_TASK);

    await ensureIntakeReady(906);

    const body = String(writeWorkflowFile.mock.calls[0]?.[2] ?? '');
    expect(body).toContain('```json:options');
    const match = body.match(/```json:options\n([\s\S]*?)\n```/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as { questions: { id: string; options: unknown[] }[] };
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].id).toBe('ia2');
    expect(parsed.questions[0].options).toHaveLength(2);
  });

  it('A回答（保持）ならacceptanceCriteriaは前後で完全一致すること', async () => {
    transitionFindFirst.mockResolvedValue({
      metadata: JSON.stringify({ selections: [{ questionId: 'ia2', selectedKey: 'A' }] }),
    });
    taskFindUnique.mockResolvedValue(SUPERVISOR_ARTIFACT_TASK);

    const r = await ensureIntakeReady(906);

    expect(r.status).toBe('ready');
    expect(taskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptanceCriteria: expect.anything() }),
      }),
    );
  });

  it('B回答（除去）なら当該基準のみが除去され他は不変であること', async () => {
    transitionFindFirst.mockResolvedValue({
      metadata: JSON.stringify({ selections: [{ questionId: 'ia2', selectedKey: 'B' }] }),
    });
    taskFindUnique.mockResolvedValue(SUPERVISOR_ARTIFACT_TASK);

    const r = await ensureIntakeReady(906);

    expect(r.status).toBe('ready');
    const call = taskUpdate.mock.calls.find((c) =>
      Object.prototype.hasOwnProperty.call((c[0] as { data: object }).data, 'acceptanceCriteria'),
    );
    expect(call).toBeDefined();
    const data = (call![0] as { data: { acceptanceCriteria: string } }).data;
    expect(JSON.parse(data.acceptanceCriteria)).toEqual(['正当な受入基準']);
    const rt = recordTransition.mock.calls.find(
      (c) => (c[0] as { cause: string }).cause === 'intake_contamination_resolved',
    );
    expect(rt).toBeDefined();
  });

  it('構造化回答が無い（自由記述のみ）場合はacceptanceCriteriaを変更せず進むこと（AC#2: あいまいな信号での無断削除禁止）', async () => {
    transitionFindFirst.mockResolvedValue({ id: 1 }); // 回答済みだが selections なし
    taskFindUnique.mockResolvedValue(SUPERVISOR_ARTIFACT_TASK);

    const r = await ensureIntakeReady(906);

    expect(r.status).toBe('ready');
    expect(taskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptanceCriteria: expect.anything() }),
      }),
    );
  });
});
