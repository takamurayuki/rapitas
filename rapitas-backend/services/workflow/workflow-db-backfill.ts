/**
 * workflow-db-backfill
 *
 * One-shot startup task that copies any workflow markdown files still on disk
 * (`~/.rapitas/workflows/...`) into the DB-backed `WorkflowFile` table — the
 * one-time migration for the switch from file storage to DB storage. Runs
 * AFTER workflow-legacy-migrator.ts so any straggler legacy-path files have
 * already been consolidated into the current layout first.
 *
 * Idempotent: a task/fileType that already has a `WorkflowFile` row is left
 * untouched (the DB is authoritative once it has content) — safe to run on
 * every boot.
 */
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getWorkflowBaseDir } from './workflow-paths';
import type { WorkflowFileType } from './workflow-types';

const log = createLogger('workflow-db-backfill');

const TRACKED_FILE_TYPES: WorkflowFileType[] = ['research', 'plan', 'question', 'verify'];

/**
 * Walk `~/.rapitas/workflows/<cat>/<theme>/<task>/` and upsert any tracked
 * markdown file into `WorkflowFile`, skipping tasks/fileTypes that already
 * have a DB row.
 *
 * @returns Number of rows backfilled. Zero when nothing to migrate. / バックフィル件数
 */
export async function backfillWorkflowFilesToDatabase(): Promise<number> {
  const baseDir = getWorkflowBaseDir();
  if (!existsSync(baseDir)) return 0;

  let backfilled = 0;
  let orphanedDirs = 0;

  // Pre-fetch every live task id ONCE instead of discovering per-directory that
  // a task is gone (an FK violation on .create()). A directory whose task was
  // since deleted will NEVER succeed and this walk runs on every boot — without
  // this check it silently re-attempted (and re-logged, at warn level, a full
  // stack trace) the SAME doomed insert for every orphaned dir × tracked file
  // type on every single startup, adding real wall-clock time and log noise
  // proportional to how many tasks had ever been deleted (observed: 100+
  // orphaned directories turning a ~2s restart into several minutes).
  const liveTaskIds = new Set(
    (await prisma.task.findMany({ select: { id: true } }).catch(() => [])).map((t) => t.id),
  );

  let categoryDirs: string[];
  try {
    categoryDirs = await readdir(baseDir);
  } catch {
    return 0;
  }

  for (const categoryDir of categoryDirs) {
    const categoryPath = join(baseDir, categoryDir);
    let themeDirs: string[];
    try {
      if (!(await stat(categoryPath)).isDirectory()) continue;
      themeDirs = await readdir(categoryPath);
    } catch {
      continue;
    }
    for (const themeDir of themeDirs) {
      const themePath = join(categoryPath, themeDir);
      let taskDirs: string[];
      try {
        if (!(await stat(themePath)).isDirectory()) continue;
        taskDirs = await readdir(themePath);
      } catch {
        continue;
      }
      for (const taskDirName of taskDirs) {
        const taskId = Number.parseInt(taskDirName, 10);
        if (!Number.isFinite(taskId)) continue;
        if (!liveTaskIds.has(taskId)) {
          orphanedDirs++;
          continue; // Task no longer exists — every insert here would FK-violate.
        }
        const taskPath = join(themePath, taskDirName);
        try {
          if (!(await stat(taskPath)).isDirectory()) continue;
        } catch {
          continue;
        }

        for (const fileType of TRACKED_FILE_TYPES) {
          const existing = await prisma.workflowFile
            .findUnique({
              where: { taskId_fileType: { taskId, fileType } },
              select: { id: true },
            })
            .catch(() => null);
          if (existing) continue; // DB already authoritative for this artifact.

          const srcFile = join(taskPath, `${fileType}.md`);
          const content = await readFile(srcFile, 'utf-8').catch(() => null);
          if (content == null) continue;

          const sha256 = createHash('sha256').update(content).digest('hex');
          const sizeBytes = Buffer.byteLength(content, 'utf-8');
          await prisma.workflowFile
            .create({
              data: { taskId, fileType, content, sha256, sizeBytes, absolutePath: srcFile },
            })
            .then(() => {
              backfilled++;
            })
            .catch((err) => {
              log.warn({ err, taskId, fileType }, 'Failed to backfill workflow file');
            });
        }
      }
    }
  }

  if (backfilled > 0) {
    log.info(`Backfilled ${backfilled} workflow file(s) from ${baseDir} into the database.`);
  }
  if (orphanedDirs > 0) {
    log.info(
      `Skipped ${orphanedDirs} orphaned workflow director(y/ies) with no matching Task row.`,
    );
  }
  return backfilled;
}
