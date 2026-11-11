/**
 * Completion criteria split into two columns on confirm (fix2 item 5, design 4.1 案1)
 *
 * Both the create mode (`/assistant/task-create`) and the plan mode
 * (`/assistant/roadmap/commit`, through the real `commitRoadmap`) write the
 * jury's criteria to `acceptanceCriteria` and the person's to
 * `userAcceptanceChecks`, by the server's own classification — whatever array
 * the client used. Also covers `/assistant/criteria/review`, which the cards
 * call after an edit, and the commit re-composing a description whose
 * checklist the user changed.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { aiClientStub } from '../../tests/helpers/ai-client-stub';

let created: Array<Record<string, unknown>> = [];

mock.module('../../utils/ai-client', () =>
  aiClientStub({
    sendAIMessage: async () => {
      throw new Error('model off');
    },
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
const { proposeCriteria, criteriaFromDescription } =
  await import('../../services/assistant/criteria-proposal');

async function call(
  app: { handle: (r: Request) => Promise<Response> },
  path: string,
  body: unknown,
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
  call(assistantRoadmapRoutes, 'roadmap/commit', {
    confirmed: true,
    goal: 'g',
    themeChoice: { kind: 'existing', id: 1 },
    projectChoice: { kind: 'none' },
    steps,
  });

beforeEach(() => {
  created = [];
});

const JURY = 'API が 200 を返す';
const USER = '本人が画面を見て納得できる';

describe('task-create writes two columns', () => {
  test('the jury’s and the person’s criteria land in their own columns', async () => {
    const { status } = await call(assistantIntakeRoutes, 'task-create', {
      confirmed: true,
      task: { title: '一覧画面を直す', themeId: 1, acceptanceCriteria: [JURY, USER] },
    });
    expect(status).toBe(200);
    expect(created[0].acceptanceCriteria).toEqual([JURY]);
    expect(created[0].userAcceptanceChecks).toEqual([USER]);
  });

  test('a person’s check sent as acceptanceCriteria by an older client still stays out of the jury’s column', async () => {
    await call(assistantIntakeRoutes, 'task-create', {
      confirmed: true,
      task: { title: 't', themeId: 1, acceptanceCriteria: [USER] },
    });
    expect(created[0].acceptanceCriteria).toEqual([]);
    expect(created[0].userAcceptanceChecks).toEqual([USER]);
  });

  test('the split follows the tags the draft showed (歯医者を予約: all the person’s)', async () => {
    const proposal = proposeCriteria({ title: '歯医者を予約', proposed: [] });
    await call(assistantIntakeRoutes, 'task-create', {
      confirmed: true,
      task: {
        title: '歯医者を予約',
        themeId: 1,
        acceptanceCriteria: [],
        userAcceptanceChecks: proposal.criteria,
      },
    });
    const jury = proposal.items.filter((i) => i.verifier === 'jury').map((i) => i.text);
    const user = proposal.items.filter((i) => i.verifier === 'user').map((i) => i.text);
    expect(created[0].acceptanceCriteria).toEqual(jury);
    expect(created[0].userAcceptanceChecks).toEqual(user);
  });

  test('nothing in either array is still refused', async () => {
    const { status } = await call(assistantIntakeRoutes, 'task-create', {
      confirmed: true,
      task: { title: 't', themeId: 1, acceptanceCriteria: [], userAcceptanceChecks: [] },
    });
    expect(status).toBe(400);
    expect(created).toEqual([]);
  });
});

describe('roadmap/commit writes two columns (real commitRoadmap)', () => {
  test('each step’s criteria are split into the two columns of the task it creates', async () => {
    const { status } = await commit([
      { title: '画面を作る', description: '作る', acceptanceCriteria: [JURY, USER] },
      { title: '確認', description: '見る', userAcceptanceChecks: [USER] },
    ]);
    expect(status).toBe(200);
    expect(created.map((c) => c.acceptanceCriteria)).toEqual([[JURY], []]);
    expect(created.map((c) => c.userAcceptanceChecks)).toEqual([[USER], [USER]]);
  });

  test('an older client sending only the description is split too', async () => {
    await commit([
      { title: '画面を作る', description: `作る\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] ${USER}` },
    ]);
    expect(created[0].acceptanceCriteria).toEqual([JURY]);
    expect(created[0].userAcceptanceChecks).toEqual([USER]);
  });

  test('a criterion removed or reworded on the card is re-composed into the description', async () => {
    const description = `作る\n\n## 完了条件\n- [ ] ${JURY}\n- [ ] 消す条件\n- [ ] ${USER}`;
    await commit([
      {
        title: '画面を作る',
        description,
        acceptanceCriteria: [`${JURY}（一覧と詳細）`],
        userAcceptanceChecks: [USER],
      },
    ]);
    const written = created[0].description as string;
    expect(criteriaFromDescription(written)).toEqual([`${JURY}（一覧と詳細）`, USER]);
    expect(written).toContain('作る');
    expect(written).not.toContain('消す条件');
    expect(written.match(/## 完了条件/g)).toHaveLength(1);
  });

  test('an unchanged checklist leaves the description byte for byte', async () => {
    const description = `作る\n\n## 完了条件\n- [ ] ${JURY}`;
    await commit([{ title: '画面を作る', description, acceptanceCriteria: [JURY] }]);
    expect(created[0].description).toBe(description);
  });
});

describe('POST /assistant/criteria/review', () => {
  test('returns the server’s tags and score for edited criteria, adding none', async () => {
    const { status, json } = await call(assistantIntakeRoutes, 'criteria/review', {
      title: '一覧画面を直す',
      criteria: [JURY, USER, '速く動く'],
    });
    expect(status).toBe(200);
    const items = json.items as Array<{ text: string; verifier: string; vague?: unknown }>;
    expect(items.map((i) => [i.text, i.verifier])).toEqual([
      [JURY, 'jury'],
      [USER, 'user'],
      ['速く動く', 'jury'],
    ]);
    expect(items[2].vague).toBeTruthy();
    expect(typeof (json.quality as { score: number }).score).toBe('number');
    expect(created).toEqual([]);
  });
});
