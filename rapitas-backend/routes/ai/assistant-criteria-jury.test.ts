/**
 * A person's checks never reach the jury's readers (review fix3 item 1)
 *
 * The columns were split in fix2, but the stored description still listed
 * every criterion under `## 完了条件`, and the jury pastes the description
 * into its prompt verbatim. These tests take what the real create / commit
 * routes hand to createTask, store it the way task-create-helpers does (JSON
 * strings), and run it through the real readers: the jury prompt builder, the
 * self-check's criteria resolver (with its description fallback), the
 * workflow role prompts, the replan review input and the landing classifier.
 *
 * Also holds the stored description's raw text (fix3 item 3) and the
 * draft / review / confirm split agreeing on the review's reproduction
 * (fix3 item 2).
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

let created: Array<Record<string, unknown>> = [];
let modelReply = '{}';

mock.module('../../utils/ai-client', () =>
  aiClientStub({
    sendAIMessage: async () => ({ success: true, content: modelReply }),
  }),
);
mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: async () => [], create: async () => ({ id: 5 }) },
    project: { findMany: async () => [], create: async () => ({ id: 6 }) },
    assistantAction: { create: async () => ({ id: 70 }) },
    taskCompanion: { updateMany: async () => ({ count: 1 }) },
  },
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../services/task/task-mutations', () => ({
  createTask: async (_prisma: unknown, data: Record<string, unknown>) => {
    created.push(data);
    return { id: 100 + created.length, ...data };
  },
}));

const { assistantIntakeRoutes } = await import('./assistant-intake.routes');
const { assistantRoadmapRoutes } = await import('./assistant-roadmap.routes');
const { buildDiffReviewPrompt } =
  await import('../../services/agents/verification/adversarial-diff-review-prompt');
const { resolveAcceptanceCriteria } =
  await import('../../services/agents/verification/acceptance-self-check');
const { buildRoleTexts } = await import('../../services/workflow/workflow-role-prompts');
const { buildReplanReviewInput } =
  await import('../../services/workflow/requirement-replan-prompt');
const { hasAcceptanceCriteria } =
  await import('../../services/supervision/task-landing-classifier');
const { proposeCriteria } = await import('../../services/assistant/criteria-proposal');

async function call(
  path: string,
  body: unknown,
  app: { handle: (r: Request) => Promise<Response> },
) {
  const res = await app.handle(
    new Request(`http://localhost/assistant/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const commit = (steps: unknown[]) =>
  call(
    'roadmap/commit',
    {
      confirmed: true,
      goal: 'g',
      themeChoice: { kind: 'existing', id: 1 },
      projectChoice: { kind: 'none' },
      steps,
    },
    assistantRoadmapRoutes,
  );

const create = (task: Record<string, unknown>) =>
  call('task-create', { confirmed: true, task: { themeId: 1, ...task } }, assistantIntakeRoutes);

beforeEach(() => {
  created = [];
  modelReply = '{}';
});

const JURY = 'API が 200 を返す';
// The review's own probe sentence: classified as the person's.
const USER = '本人が操作して納得できる';

/** The row as task-create-helpers writes it: arrays become JSON strings. */
function stored(data: Record<string, unknown>) {
  const json = (v: unknown) =>
    Array.isArray(v) && v.length > 0 ? JSON.stringify(v) : (null as string | null);
  return {
    title: String(data.title),
    description: (data.description as string | undefined) ?? null,
    acceptanceCriteria: json(data.acceptanceCriteria),
    userAcceptanceChecks: json(data.userAcceptanceChecks),
  };
}

/** Every text a jury-side reader is given for this task. */
function juryReaderTexts(task: ReturnType<typeof stored>): Record<string, string> {
  const criteria = resolveAcceptanceCriteria(task);
  return {
    juryPrompt: buildDiffReviewPrompt({
      taskTitle: task.title,
      taskDescription: task.description,
      planContent: 'plan',
      acceptanceCriteria: task.acceptanceCriteria ? JSON.parse(task.acceptanceCriteria) : [],
      diffText: '+x',
    }),
    selfCheck: criteria.join('\n'),
    rolePrompt: buildRoleTexts(1, task, 'ja').taskInfo,
    replan:
      buildReplanReviewInput({
        title: task.title,
        description: task.description ?? '',
        goals: [],
        constraints: [],
        acceptanceCriteria: task.acceptanceCriteria ? JSON.parse(task.acceptanceCriteria) : [],
        plan: 'p',
        verify: 'v',
      }) ?? '',
    landingColumn: task.acceptanceCriteria ?? '',
  };
}

function expectNoPersonCheck(texts: Record<string, string>, person: string[]) {
  for (const [reader, text] of Object.entries(texts)) {
    for (const p of person) {
      expect({ reader, leaked: text.includes(p) }).toEqual({ reader, leaked: false });
    }
  }
}

describe('roadmap/commit: the stored description carries the jury’s criteria only', () => {
  test('the jury prompt built from the stored task never shows the person’s check', async () => {
    const { status } = await commit([
      {
        title: '一覧画面を直す',
        description: `直す\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] ${USER}`,
        acceptanceCriteria: [JURY],
        userAcceptanceChecks: [USER],
      },
    ]);
    expect(status).toBe(200);
    const task = stored(created[0]);
    expect(task.userAcceptanceChecks).toBe(JSON.stringify([USER]));
    const texts = juryReaderTexts(task);
    expect(texts.juryPrompt).toContain(JURY);
    expectNoPersonCheck(texts, [USER]);
  });

  test('an older client sending everything in acceptanceCriteria (and the description) is cut too', async () => {
    await commit([
      {
        title: '一覧画面を直す',
        description: `直す\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] ${USER}`,
        acceptanceCriteria: [JURY, USER],
      },
    ]);
    expectNoPersonCheck(juryReaderTexts(stored(created[0])), [USER]);
  });

  test('an older client sending only the description is cut too', async () => {
    await commit([
      { title: '一覧画面を直す', description: `直す\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] ${USER}` },
    ]);
    const task = stored(created[0]);
    expect(task.acceptanceCriteria).toBe(JSON.stringify([JURY]));
    expectNoPersonCheck(juryReaderTexts(task), [USER]);
  });

  test('an errand (all the person’s): no checklist, so the self-check fallback finds nothing of theirs', async () => {
    const proposal = proposeCriteria({ title: '歯医者を予約', proposed: [] });
    await commit([
      {
        title: '歯医者を予約',
        description: `電話で予約する\n\n## 完了条件\n${proposal.criteria.map((c) => `- [ ] ${c}`).join('\n')}`,
        userAcceptanceChecks: proposal.criteria,
      },
    ]);
    const task = stored(created[0]);
    expect(task.acceptanceCriteria).toBeNull();
    expect(task.description).toBe('電話で予約する');
    expectNoPersonCheck(juryReaderTexts(task), proposal.criteria);
    expect(resolveAcceptanceCriteria(task)).toEqual([]);
    // The landing classifier reads only the column, which is empty: criteria_missing, as before.
    expect(hasAcceptanceCriteria(task.acceptanceCriteria)).toBe(false);
  });

  test('a second checklist appended by a client is not left behind', async () => {
    await commit([
      {
        title: '一覧画面を直す',
        description: `直す\n\n## 完了条件\n- [ ] ${USER}\n\n## 完了条件\n- [ ] ${JURY}`,
        acceptanceCriteria: [JURY],
        userAcceptanceChecks: [USER],
      },
    ]);
    expect(created[0].description).toBe(`直す\n\n## 完了条件\n- [ ] ${JURY}`);
  });
});

describe('task-create: the stored description carries the jury’s criteria only', () => {
  test('a checklist in the description is cut to the jury’s criteria', async () => {
    const { status } = await create({
      title: '一覧画面を直す',
      description: `直す\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] ${USER}`,
      acceptanceCriteria: [JURY, USER],
    });
    expect(status).toBe(200);
    const task = stored(created[0]);
    expect(task.description).toBe(`直す\n\n## 完了条件\n- [ ] ${JURY}`);
    const texts = juryReaderTexts(task);
    expect(texts.juryPrompt).toContain(JURY);
    expectNoPersonCheck(texts, [USER]);
  });

  test('a person’s check listed under another heading is dropped from the text', async () => {
    await create({
      title: '一覧画面を直す',
      description: `直す\n\n## 受入基準\n- ${JURY}\n- ${USER}`,
      acceptanceCriteria: [JURY, USER],
    });
    const task = stored(created[0]);
    expect(task.description).toBe(`直す\n\n## 受入基準\n- ${JURY}`);
    expectNoPersonCheck(juryReaderTexts(task), [USER]);
  });

  test('a description with neither is stored byte for byte (no checklist added)', async () => {
    const description = '一覧の並びを直す。\n  詳細は Issue を見る  ';
    await create({ title: '一覧画面を直す', description, acceptanceCriteria: [JURY, USER] });
    expect(created[0].description).toBe(description);
  });
});

describe('the review’s reproduction: 歯医者を予約 (fix3 item 2)', () => {
  const LISTED = ['予約確認の画面を保存する', '日時が決まる', '場所が決まる'];
  const legacy = `電話で予約する\n\n## 完了条件\n${LISTED.map((c) => `- [ ] ${c}`).join('\n')}`;

  test('draft split = /criteria/review split = the columns confirm writes', async () => {
    modelReply = JSON.stringify({
      goal: '歯医者',
      themeChoice: { kind: 'none' },
      projectChoice: { kind: 'none' },
      questions: [],
      steps: [{ title: '歯医者を予約', description: legacy }],
    });
    const draft = await call(
      'roadmap/draft',
      { text: '歯医者を予約したい' },
      assistantRoadmapRoutes,
    );
    const step = (
      draft.json.draft as {
        steps: Array<{
          title: string;
          description: string;
          acceptanceCriteria: string[];
          criteriaItems: Array<{ text: string; verifier: string }>;
        }>;
      }
    ).steps[0];
    expect(step.acceptanceCriteria).toEqual(LISTED);
    const drafted = step.criteriaItems.map((i) => [i.text, i.verifier]);

    // The card sends the description both with (older clients) and without
    // the checklist; either way the server's tags are the draft's.
    for (const description of [step.description, '電話で予約する']) {
      const review = await call(
        'criteria/review',
        { title: step.title, description, criteria: step.acceptanceCriteria },
        assistantIntakeRoutes,
      );
      const items = review.json.items as Array<{ text: string; verifier: string }>;
      expect(items.map((i) => [i.text, i.verifier])).toEqual(drafted);
    }

    // Confirm, the older way (everything as acceptanceCriteria, description as drafted).
    await commit([
      {
        title: step.title,
        description: step.description,
        acceptanceCriteria: step.acceptanceCriteria,
      },
    ]);
    const jury = drafted.filter(([, v]) => v === 'jury').map(([t]) => t);
    const user = drafted.filter(([, v]) => v === 'user').map(([t]) => t);
    expect(created[0].acceptanceCriteria).toEqual(jury);
    expect(created[0].userAcceptanceChecks).toEqual(user);
    // An errand: every one of them is the person's.
    expect(user).toEqual(LISTED);
  });
});

describe('the stored description’s raw text (fix3 item 3)', () => {
  test('A／B／C／A from an older client: three lines in the text, matching the columns', async () => {
    await commit([
      {
        title: '一覧画面を直す',
        description: `直す\n\n## 完了条件\n- [ ] 一覧 API が 200 を返す\n- [ ] 詳細 API が 200 を返す\n- [ ] 削除 API が 204 を返す\n- [ ] 一覧 API が 200 を返す`,
      },
    ]);
    const description = created[0].description as string;
    expect(description.split('\n')).toEqual([
      '直す',
      '',
      '## 完了条件',
      '- [ ] 一覧 API が 200 を返す',
      '- [ ] 詳細 API が 200 を返す',
      '- [ ] 削除 API が 204 を返す',
    ]);
    expect(created[0].acceptanceCriteria).toEqual([
      '一覧 API が 200 を返す',
      '詳細 API が 200 を返す',
      '削除 API が 204 を返す',
    ]);
  });
});
