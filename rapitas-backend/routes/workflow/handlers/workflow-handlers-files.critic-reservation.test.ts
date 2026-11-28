/**
 * workflow-handlers-files.critic-reservation.test.ts
 *
 * A plan save writes plan_created before its critique registers. The handler
 * must hold a critique reservation across that window and drop it before plan
 * post-processing (task 1593). Uses the real in-flight registry.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { hasCritiqueInFlight } from '../../../services/workflow/phase-critic/critic-inflight';

mock.module('../../../config', () => ({ prisma: {} }));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {},
}));
mock.module('../core/workflow-helpers', () => ({
  VALID_FILE_TYPES: ['research', 'question', 'plan', 'verify'],
  resolveWorkflowDir: () => Promise.resolve(null),
  getFileInfo: () => Promise.resolve({ exists: false }),
}));

const TASK_ID = 1593;
const seen: Record<string, boolean> = {};
let failAt: 'transition' | 'critic' | null = null;

/** Records whether the task counted as being critiqued at this stage. */
function stage(name: 'transition' | 'critic' | 'planPost'): void {
  seen[name] = hasCritiqueInFlight(TASK_ID);
  if (failAt === name) throw new Error(`${name} failed`);
}

mock.module('./file-save', () => ({
  validateFileType: (ft: string) => ft,
  resolveTargetTask: async () => ({
    task: { workflowStatus: 'research_done', workflowMode: null },
    categoryId: 1,
    themeId: 1,
  }),
  guardStatusTransition: async () => ({ ok: true, status: 'research_done' }),
  guardParentSubtasksTerminal: async () => {},
  prepareAndPersistContent: async () => ({
    ok: true,
    content: 'P',
    fileLanguage: 'ja',
    savedContent: 'P',
  }),
  computeAndApplyStatusTransition: async () => {
    stage('transition');
    return { newStatus: 'plan_created' };
  },
  runPhaseCriticGate: async ({ newStatus }: { newStatus: string }) => {
    stage('critic');
    return { newStatus, criticRejection: null };
  },
  runPlanPostProcessing: async ({ newStatus }: { newStatus: string }) => {
    stage('planPost');
    return { newStatus, autoApproved: false, splitResult: null };
  },
  runVerifyPostSaveAutomation: async ({ newStatus }: { newStatus: string }) => ({
    newStatus,
    taskMarkedDone: false,
    autoCommitPRResult: {},
  }),
}));
mock.module('../../../services/workflow/research-criteria-review', () => ({
  settleCriteriaFromResearch: async () => false,
}));

const { handleSaveFile } = await import('./workflow-handlers-files');

const save = (fileType: string) =>
  handleSaveFile({
    params: { taskId: String(TASK_ID), fileType },
    body: { content: 'P' },
    set: { status: 200 },
  });

beforeEach(() => {
  for (const key of Object.keys(seen)) delete seen[key];
  failAt = null;
});

describe('handleSaveFile critique reservation', () => {
  it('holds the reservation from before the status write until the gate returns', async () => {
    await save('plan');
    expect(seen).toEqual({ transition: true, critic: true, planPost: false });
    expect(hasCritiqueInFlight(TASK_ID)).toBe(false);
  });

  for (const failing of ['transition', 'critic'] as const) {
    it(`releases the reservation when the ${failing} stage throws`, async () => {
      failAt = failing;
      await expect(save('plan')).rejects.toThrow(`${failing} failed`);
      expect(hasCritiqueInFlight(TASK_ID)).toBe(false);
    });
  }

  it('does not reserve for a non-plan save', async () => {
    await save('research');
    expect(seen.transition).toBe(false);
  });
});
