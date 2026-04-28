/**
 * workflow-legacy-migrator
 *
 * One-shot startup task that copies legacy workflow files from the old
 * in-repo location (`<process.cwd()>/tasks/<cat>/<theme>/<task>/`) to the
 * new user-data location (`~/.rapitas/workflows/...`).
 *
 * Idempotent: skips files that already exist at the new path. Safe to run
 * on every boot — costs only a `readdir` of the legacy directory when it
 * is absent.
 */
import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../config/logger';
import { getWorkflowBaseDir } from './workflow-paths';

const log = createLogger('workflow-legacy-migrator');

/** Markdown filenames we care about — anything else in the dir is left alone. */
const TRACKED_FILENAMES = new Set(['research.md', 'plan.md', 'question.md', 'verify.md']);

/**
 * Walk the legacy `<cwd>/tasks/<cat>/<theme>/<task>/` tree and mirror tracked
 * markdown files into the new layout. Returns the count of files copied.
 *
 * @returns Number of files copied. Zero when nothing to migrate. / コピー件数
 */
export async function migrateLegacyWorkflowFiles(): Promise<number> {
  const legacyRoot = join(process.cwd(), 'tasks');
  if (!existsSync(legacyRoot)) return 0;

  const newRoot = getWorkflowBaseDir();
  let copied = 0;

  // legacyRoot/<categoryDir>/<themeDir>/<taskDir>/<file>.md
  let categoryDirs: string[];
  try {
    categoryDirs = await readdir(legacyRoot);
  } catch {
    return 0;
  }

  for (const categoryDir of categoryDirs) {
    const categoryPath = join(legacyRoot, categoryDir);
    let themeDirs: string[];
    try {
      const stats = await stat(categoryPath);
      if (!stats.isDirectory()) continue;
      themeDirs = await readdir(categoryPath);
    } catch {
      continue;
    }
    for (const themeDir of themeDirs) {
      const themePath = join(categoryPath, themeDir);
      let taskDirs: string[];
      try {
        const stats = await stat(themePath);
        if (!stats.isDirectory()) continue;
        taskDirs = await readdir(themePath);
      } catch {
        continue;
      }
      for (const taskDir of taskDirs) {
        const taskPath = join(themePath, taskDir);
        let entries: string[];
        try {
          const stats = await stat(taskPath);
          if (!stats.isDirectory()) continue;
          entries = await readdir(taskPath);
        } catch {
          continue;
        }
        const target = join(newRoot, categoryDir, themeDir, taskDir);
        await mkdir(target, { recursive: true });
        for (const entry of entries) {
          if (!TRACKED_FILENAMES.has(entry)) continue;
          const srcFile = join(taskPath, entry);
          const dstFile = join(target, entry);
          if (existsSync(dstFile)) continue;
          try {
            await copyFile(srcFile, dstFile);
            copied++;
          } catch (err) {
            log.warn(
              { err: err instanceof Error ? err.message : err, src: srcFile },
              'Failed to copy legacy workflow file',
            );
          }
        }
      }
    }
  }

  if (copied > 0) {
    log.info(
      `Migrated ${copied} legacy workflow file(s) from ${legacyRoot} → ${newRoot}. ` +
        'You can delete the legacy directory once the new layout is verified.',
    );
  }
  return copied;
}
