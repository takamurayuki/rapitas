/**
 * NotesJobs
 *
 * Schedules the notes stage-1 background work: at start and then hourly
 * (design §2.2 contract 6, §3.3 「取りこぼしの点検」).
 *
 * Order of one run: the one-time initial placement (a no-op once done), the
 * placement consistency check, then the deliverable check (whose first run
 * writes the baseline before anything else can be created from old tasks).
 * Runs never overlap; a run that is still going when the next tick comes
 * makes that tick a no-op.
 *
 * Not responsible for the work itself — see placement/ and deliverables/.
 */
import { createLogger } from '../../../config/logger';
import type { PrismaInstance } from '../note-record';
import { runPlacementInitialMigration } from '../placement/placement-initial';
import { runPlacementConsistencyCheck } from '../placement/placement-consistency-job';
import { runDeliverableCheck } from '../deliverables/deliverable-check';

const logger = createLogger('notes-jobs');

/** How often the checks run. */
export const NOTES_JOB_INTERVAL_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

/**
 * One run of every notes job, each isolated from the others' failures.
 *
 * @param db - The client, used without a workspace scope / スコープなしのクライアント
 */
export async function runNotesJobsOnce(db: PrismaInstance): Promise<void> {
  if (running) return running;
  running = (async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ['placement-initial', () => runPlacementInitialMigration(db)],
      ['placement-consistency', () => runPlacementConsistencyCheck(db)],
      ['deliverable-check', () => runDeliverableCheck(db)],
    ];
    for (const [label, step] of steps) {
      try {
        await step();
      } catch (err) {
        logger.warn({ err, job: label }, 'notes job failed; the next run retries');
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Start the jobs: one run now, then every NOTES_JOB_INTERVAL_MS.
 * Calling it twice does not start a second schedule.
 *
 * @param db - The client / クライアント
 */
export function startNotesJobs(db: PrismaInstance): void {
  if (timer) return;
  void runNotesJobsOnce(db);
  timer = setInterval(() => void runNotesJobsOnce(db), NOTES_JOB_INTERVAL_MS);
  // Never keep the process alive just for this.
  (timer as { unref?: () => void }).unref?.();
}

/** Stop the schedule (tests, shutdown). */
export function stopNotesJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
