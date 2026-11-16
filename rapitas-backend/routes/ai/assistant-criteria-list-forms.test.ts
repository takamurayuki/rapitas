/**
 * A person's check never reaches the jury, whatever list form it is written in
 * (review fix4)
 *
 * The self-check's description fallback reads `-`, `*`, `+`, `1.` and `1)`
 * items under `## 受入基準`, but the save side only dropped `-` / `*` lines,
 * so `1. 本人が操作して納得できる` under that heading survived both create and
 * commit and reached the jury prompt and the self-check. These tests run the
 * review's reproduction through the real routes and the real readers in every
 * form, and tie the save side's list rule to the reader's line by line.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

let created: Array<Record<string, unknown>> = [];

mock.module('../../utils/ai-client', () =>
  aiClientStub({ sendAIMessage: async () => ({ success: true, content: '{}' }) }),
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
const { resolveAcceptanceCriteria, extractCriteriaFromDescription } =
  await import('../../services/agents/verification/acceptance-self-check');
const { buildRoleTexts } = await import('../../services/workflow/workflow-role-prompts');
const { buildReplanReviewInput } =
  await import('../../services/workflow/requirement-replan-prompt');
const { descriptionForJury } = await import('../../services/assistant/criteria-text');

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
  return res.status;
}

beforeEach(() => {
  created = [];
});

const TITLE = '歯医者を予約';
const USER = '本人が操作して納得できる';
/** Every list marker the self-check's description fallback reads. */
const FORMS = ['- ', '* ', '+ ', '1. ', '1) '];

const ROUTES: Record<string, (description: string) => Promise<number>> = {
  'task-create': (description) =>
    call(
      'task-create',
      {
        confirmed: true,
        task: { themeId: 1, title: TITLE, description, userAcceptanceChecks: [USER] },
      },
      assistantIntakeRoutes,
    ),
  'roadmap/commit': (description) =>
    call(
      'roadmap/commit',
      {
        confirmed: true,
        goal: 'g',
        themeChoice: { kind: 'existing', id: 1 },
        projectChoice: { kind: 'none' },
        steps: [{ title: TITLE, description, userAcceptanceChecks: [USER] }],
      },
      assistantRoadmapRoutes,
    ),
};

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

describe('the review’s reproduction: a person’s check under ## 受入基準, in every list form', () => {
  for (const [route, save] of Object.entries(ROUTES)) {
    for (const form of FORMS) {
      test(`${route}, "${form.trim()}": neither the jury prompt nor the self-check sees it`, async () => {
        const status = await save(`電話で予約する\n\n## 受入基準\n${form}${USER}`);
        expect(status).toBe(200);
        const task = stored(created[0]);
        expect(task.userAcceptanceChecks).toBe(JSON.stringify([USER]));
        const juryPrompt = buildDiffReviewPrompt({
          taskTitle: task.title,
          taskDescription: task.description,
          planContent: 'plan',
          acceptanceCriteria: task.acceptanceCriteria ? JSON.parse(task.acceptanceCriteria) : [],
          diffText: '+x',
        });
        const selfCheck = resolveAcceptanceCriteria(task);
        expect({ juryLeaked: juryPrompt.includes(USER) }).toEqual({ juryLeaked: false });
        expect(selfCheck).toEqual([]);
        expect(buildRoleTexts(1, task, 'ja').taskInfo.includes(USER)).toBe(false);
        const replan =
          buildReplanReviewInput({
            title: task.title,
            description: task.description ?? '',
            goals: [],
            constraints: [],
            acceptanceCriteria: [],
            plan: 'p',
            verify: 'v',
          }) ?? '';
        expect(replan.includes(USER)).toBe(false);
        expect(task.description).toBe('電話で予約する\n\n## 受入基準');
      });
    }
  }
});

describe('the save side’s list rule is the self-check’s', () => {
  // Shapes the reader accepts; for each, whatever it reads as an item the
  // save side must recognise as that same item and drop.
  const LINES = [
    `- ${USER}`,
    `* ${USER}`,
    `+ ${USER}`,
    `1. ${USER}`,
    `1) ${USER}`,
    `12. ${USER}`,
    `3) ${USER}`,
    `  - [ ] ${USER}`,
    `+ [x] ${USER}`,
    `2) [X] ${USER}`,
    `1.\t${USER}  `,
    `   * [ ]   ${USER}`,
  ];
  for (const line of LINES) {
    test(`"${line}"`, () => {
      const description = `直す\n\n## 受入基準\n${line}\n- API が 200 を返す`;
      const read = extractCriteriaFromDescription(description);
      expect(read).toContain(USER);
      const cleaned = descriptionForJury(
        description,
        { acceptanceCriteria: [], userAcceptanceChecks: [USER] },
        { section: 'ifPresent' },
      );
      expect(extractCriteriaFromDescription(cleaned)).toEqual(['API が 200 を返す']);
    });
  }

  test('a numbered line that is not one of the person’s checks is kept', () => {
    const description = `直す\n\n## 受入基準\n1. API が 200 を返す\n2) ${USER}`;
    const cleaned = descriptionForJury(
      description,
      { acceptanceCriteria: ['API が 200 を返す'], userAcceptanceChecks: [USER] },
      { section: 'ifPresent' },
    );
    expect(cleaned).toBe('直す\n\n## 受入基準\n1. API が 200 を返す');
  });
});
