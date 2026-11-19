/**
 * deliverable-create.race.test
 *
 * A completion that changes while its deliverable is being generated (design
 * §3.3「同時起動・再実行の契約」, review G2 must-fix 3). The body is generated
 * outside the transaction, so during the model call the task can be reopened,
 * or reopened and completed again (the entry then writes a new `pending`
 * record). The attempt is tied to the record it read:
 *
 * - reopened → no note; the record it read becomes not_eligible.
 * - completed again → the stale attempt writes nothing (no note, no state);
 *   the new completion's attempt creates the note from the files as they are now.
 * - a stale attempt whose generation failed does not mark the new record failed.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../../tests/helpers/notes-stage1-db';
import { computeContentSha256 } from '../note-version';

let reply: string | Error = 'TITLE: 成果\nBODY:\n## 結論\nできた';
let calls = 0;
let onGenerate: (() => Promise<void> | void) | null = null;
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    const hook = onGenerate;
    onGenerate = null;
    await hook?.();
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const { createDeliverableForTask } = await import('./deliverable-create');
const { recordTaskCompletionTx } = await import('./deliverable-completion');

type Row = Record<string, unknown>;
const FIRST = `# 検証\n\n${'最初の完了の確認結果を記録した。'.repeat(20)}`;
const SECOND = `# 検証\n\n${'二度目の完了で確認し直した結果を記録した。'.repeat(20)}`;

let db: Stage1Db;
const p = () => db.prisma as never;
const record = () => db.find('taskDeliverableCompletion', { taskId: 7 }) as Row;
const note = () => db.find('note', { id: 'deliverable-task-7' }) as Row | undefined;
const task = () => db.find('task', { id: 7 }) as Row;
const verifyFile = () => db.find('workflowFile', { taskId: 7, fileType: 'verify' }) as Row;

beforeEach(async () => {
  reply = 'TITLE: 成果\nBODY:\n## 結論\nできた';
  calls = 0;
  onGenerate = null;
  db = createStage1Db({
    theme: [{ id: 10, name: '英語' }],
    task: [{ id: 7, title: '単元1', themeId: 10, status: 'done' }],
    workflowFile: [{ taskId: 7, fileType: 'verify', content: FIRST }],
  });
  await recordTaskCompletionTx(p(), 7, 'manual', new Date('2026-11-01T00:00:00Z'));
});

describe('a completion that changes during generation', () => {
  it('creates nothing when the task is reopened meanwhile', async () => {
    onGenerate = () => {
      task().status = 'todo';
    };
    expect(await createDeliverableForTask(p(), 7)).toBe('not_eligible');
    expect(note()).toBeUndefined();
    expect(record()).toMatchObject({ state: 'not_eligible', mode: 'manual' });
  });

  it('lets the re-completion’s record win over the stale attempt', async () => {
    let second: Promise<unknown> | null = null;
    onGenerate = async () => {
      // Reopened, verify.md rewritten, completed again by a workflow: the entry
      // writes its record and starts its own attempt while ours is generating.
      task().status = 'todo';
      verifyFile().content = SECOND;
      task().status = 'done';
      await recordTaskCompletionTx(p(), 7, 'workflow_verify', new Date('2026-11-02T00:00:00Z'));
      second = createDeliverableForTask(p(), 7);
    };
    await createDeliverableForTask(p(), 7);
    await second;
    expect(record()).toMatchObject({
      mode: 'workflow_verify',
      completedAt: new Date('2026-11-02T00:00:00Z'),
      state: 'created',
    });
    // The note is the second completion's, made from the rewritten verify.md.
    const ref = JSON.parse(String(note()?.sourceRef)) as { sha256: string };
    expect(ref.sha256).toBe(computeContentSha256(SECOND));
    expect(calls).toBe(2);
  });

  it('does not mark the re-completion’s record failed when the stale generation fails', async () => {
    reply = new Error('model down');
    onGenerate = async () => {
      await recordTaskCompletionTx(p(), 7, 'workflow_verify', new Date('2026-11-02T00:00:00Z'));
    };
    await createDeliverableForTask(p(), 7);
    expect(record()).toMatchObject({
      mode: 'workflow_verify',
      completedAt: new Date('2026-11-02T00:00:00Z'),
      state: 'pending',
      attempts: 0,
    });
    expect(note()).toBeUndefined();
  });
});
