/**
 * deliverable-create.test
 *
 * Creating a deliverable note from a completion record (design §3.3), over
 * the in-memory database with the model call replaced: fixed id, "create if
 * absent" (a re-run never rewrites a person's edit), note + link + record in
 * one transaction, nothing saved when generation fails, the 200-character
 * rule, and the workspace of the task deciding everything.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../../tests/helpers/notes-stage1-db';

let reply: string | Error = 'TITLE: 単元1の成果\nBODY:\n## 結論\nできた';
let calls = 0;
let onGenerate: (() => void) | null = null;
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    onGenerate?.();
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { createDeliverableForTask } = await import('./deliverable-create');
const { recordTaskCompletionTx } = await import('./deliverable-completion');

type Row = Record<string, unknown>;
const LONG = `# 検証\n\n${'変更点と確認結果を記録した。'.repeat(20)}`; // well over 200 characters
const SHORT = '# 検証\n\n短い';

let db: Stage1Db;
const p = () => db.prisma as never;
const record = (taskId: number) => db.find('taskDeliverableCompletion', { taskId }) as Row;
const note = (id: string) => db.find('note', { id }) as Row | undefined;

function seed(files: { verify?: string; research?: string }, taskOverrides: Row = {}) {
  db = createStage1Db({
    category: [{ id: 1, name: '学習' }],
    theme: [
      { id: 10, name: '英語', categoryId: 1 },
      { id: 20, name: 'WS2', workspaceId: 2 },
    ],
    task: [
      { id: 7, title: '単元1', themeId: 10, status: 'done', ...taskOverrides },
      { id: 70, title: 'WS2のタスク', themeId: 20, status: 'done', workspaceId: 2 },
    ],
    workflowFile: [
      ...(files.verify !== undefined
        ? [{ taskId: 7, fileType: 'verify', content: files.verify }]
        : []),
      ...(files.research !== undefined
        ? [{ taskId: 7, fileType: 'research', content: files.research }]
        : []),
      { taskId: 70, fileType: 'verify', content: LONG, workspaceId: 2 },
    ],
  });
}

async function complete(taskId = 7, mode: 'manual' | 'workflow_verify' = 'manual') {
  await recordTaskCompletionTx(p(), taskId, mode, new Date());
}

beforeEach(() => {
  reply = 'TITLE: 単元1の成果\nBODY:\n## 結論\nできた';
  calls = 0;
  onGenerate = null;
});

describe('creating the deliverable note', () => {
  it('creates the fixed-id note, its link and the created record together', async () => {
    seed({ verify: LONG });
    await complete();
    expect(await createDeliverableForTask(p(), 7)).toBe('created');
    expect(note('deliverable-task-7')).toMatchObject({
      title: '単元1の成果',
      source: 'deliverable',
      sourceTaskId: 7,
      followsTask: true,
      themeId: 10,
    });
    const ref = JSON.parse(note('deliverable-task-7')?.sourceRef as string);
    expect(ref).toMatchObject({ taskId: 7, fileType: 'verify' });
    expect(typeof ref.sha256).toBe('string');
    expect(typeof ref.generatedAt).toBe('string');
    expect(db.find('noteTaskLink', { noteId: 'deliverable-task-7', taskId: 7 })).toBeDefined();
    expect(record(7)).toMatchObject({ state: 'created', attempts: 1, mode: 'manual' });
  });

  it('uses research.md when there is no qualifying verify.md', async () => {
    seed({ verify: SHORT, research: LONG });
    await complete();
    await createDeliverableForTask(p(), 7);
    expect(note('research-task-7')).toMatchObject({ source: 'research' });
    expect(note('deliverable-task-7')).toBeUndefined();
  });

  it('marks a short file not_eligible without calling the model', async () => {
    seed({ verify: SHORT });
    await complete();
    expect(await createDeliverableForTask(p(), 7)).toBe('not_eligible');
    expect(calls).toBe(0);
  });

  it('saves nothing and marks failed when generation fails', async () => {
    seed({ verify: LONG });
    reply = new Error('cli down');
    await complete();
    expect(await createDeliverableForTask(p(), 7)).toBe('failed');
    expect(note('deliverable-task-7')).toBeUndefined();
    expect(db.rows('noteTaskLink')).toEqual([]);
    expect(record(7)).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('treats a reply without a usable body as a failure', async () => {
    seed({ verify: LONG });
    reply = '   ';
    await complete();
    expect(await createDeliverableForTask(p(), 7)).toBe('failed');
    expect(note('deliverable-task-7')).toBeUndefined();
  });

  it('never rewrites an existing note on a re-completion', async () => {
    seed({ verify: LONG });
    await complete();
    await createDeliverableForTask(p(), 7);
    (note('deliverable-task-7') as Row).content = '人が直した';
    await complete(7, 'workflow_verify'); // entry: mode updated, state back to pending
    expect(record(7)).toMatchObject({ state: 'pending', mode: 'workflow_verify' });
    expect(await createDeliverableForTask(p(), 7)).toBe('created');
    expect(note('deliverable-task-7')?.content).toBe('人が直した');
    expect(calls).toBe(1);
  });

  it('treats a unique violation at create as already created, keeping the other writer’s note', async () => {
    seed({ verify: LONG });
    await complete();
    // Another writer commits the same id while this run is generating.
    onGenerate = () => {
      db.rows('note').push({
        id: 'deliverable-task-7',
        title: '先客',
        content: '先',
        workspaceId: null,
      });
    };
    expect(await createDeliverableForTask(p(), 7)).toBe('created');
    expect(note('deliverable-task-7')?.title).toBe('先客');
    expect(record(7).state).toBe('created');
  });

  it('rides a concurrent entry for the same task on one run', async () => {
    seed({ verify: LONG });
    await complete();
    const [a, b] = await Promise.all([
      createDeliverableForTask(p(), 7),
      createDeliverableForTask(p(), 7),
    ]);
    expect([a, b]).toEqual(['created', 'created']);
    expect(calls).toBe(1);
  });

  it('creates in the task’s own workspace', async () => {
    seed({});
    await complete(70);
    await createDeliverableForTask(p(), 70);
    expect(note('deliverable-task-70')).toMatchObject({ workspaceId: 2, themeId: 20 });
    expect(record(70)).toMatchObject({ workspaceId: 2, state: 'created' });
  });

  it('does not act on a record written for another workspace than its task', async () => {
    seed({ verify: LONG });
    await complete();
    record(7).workspaceId = 2;
    expect(await createDeliverableForTask(p(), 7)).toBe('failed');
    expect(note('deliverable-task-7')).toBeUndefined();
  });

  it('places the note in 未分類 when the task has no effective theme', async () => {
    seed({ verify: LONG }, { themeId: null });
    await complete();
    await createDeliverableForTask(p(), 7);
    expect(note('deliverable-task-7')).toMatchObject({
      themeId: null,
      categoryId: null,
      folderId: null,
      followsTask: true,
    });
  });

  it('leaves a reopened task alone until it completes again', async () => {
    seed({ verify: LONG }, { status: 'todo' });
    await complete();
    expect(await createDeliverableForTask(p(), 7)).toBe('not_eligible');
    expect(calls).toBe(0);
  });

  it('skips records that are not pending or failed', async () => {
    seed({ verify: LONG });
    db.rows('taskDeliverableCompletion').push({
      taskId: 7,
      workspaceId: null,
      mode: 'baseline',
      state: 'baseline',
      completedAt: new Date(),
      attempts: 0,
    });
    expect(await createDeliverableForTask(p(), 7)).toBe('skipped');
  });
});
