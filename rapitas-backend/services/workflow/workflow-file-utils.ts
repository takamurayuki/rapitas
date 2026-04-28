/**
 * Workflow File Utils
 *
 * Low-level filesystem helpers for reading, writing, and cleaning up workflow
 * Markdown files. Does not contain any business logic or DB access.
 */
import { readFile, writeFile, mkdir, rename, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { prisma } from '../../config';
import { sanitizeMarkdownContent } from '../../utils/common/mojibake-detector';
import { createLogger } from '../../config/logger';
import { getTaskWorkflowDir, getArchiveDir } from './workflow-paths';

const log = createLogger('workflow-file-utils');

export type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';

/**
 * Resolve the workflow directory path from a task ID.
 *
 * @param taskId - The task ID to resolve. / 解決するタスクID
 * @returns Directory info or null if the task does not exist. / タスクが存在しない場合はnull
 */
export async function resolveWorkflowDir(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });
  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;
  const categoryDir = categoryId !== null ? String(categoryId) : '0';
  const themeDir = themeId !== null ? String(themeId) : '0';

  // Suppress unused-variable lint while keeping the previously-computed
  // legacy `<cwd>/tasks/...` constants available for read-time fallback.
  void categoryDir;
  void themeDir;
  return {
    task,
    dir: getTaskWorkflowDir(categoryId, themeId, taskId),
    categoryId,
    themeId,
  };
}

/**
 * Read the content of a workflow file.
 *
 * @param dir - Absolute path to the workflow directory. / ワークフローディレクトリの絶対パス
 * @param fileType - The workflow file type to read. / 読み込むワークフローファイルの種類
 * @returns File content string or null if not found. / ファイル内容またはnull
 */
export async function readWorkflowFile(
  dir: string,
  fileType: WorkflowFileType,
): Promise<string | null> {
  try {
    const filePath = join(dir, `${fileType}.md`);
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write to a workflow file, applying mojibake correction before saving.
 * Existing content (if any) is archived under `_archive/<timestamp>/` so a
 * regenerated plan never silently destroys the previous version, and a
 * matching `WorkflowFile` metadata row is upserted for DB-level queries.
 *
 * @param dir - Absolute path to the workflow directory. / ワークフローディレクトリの絶対パス
 * @param fileType - The workflow file type to write. / 書き込むワークフローファイルの種類
 * @param content - Markdown content to write. / 書き込むMarkdownコンテンツ
 * @param taskId - Optional task id; when provided, metadata is recorded in the
 *                 `WorkflowFile` table for indexing. / タスクID（メタ記録用）
 */
export async function writeWorkflowFile(
  dir: string,
  fileType: WorkflowFileType,
  content: string,
  taskId?: number,
): Promise<string> {
  await mkdir(dir, { recursive: true });

  // Mojibake detection and correction
  const sanitizeResult = sanitizeMarkdownContent(content);
  if (sanitizeResult.wasFixed) {
    log.info(
      { issues: sanitizeResult.issues },
      `[WorkflowFileUtils] Fixed mojibake in ${fileType}.md`,
    );
  }

  const filePath = join(dir, `${fileType}.md`);

  // Archive the previous version when present so users can compare iterations.
  try {
    await stat(filePath);
    const archiveDir = getArchiveDir(dir, new Date().toISOString());
    await mkdir(archiveDir, { recursive: true });
    await rename(filePath, join(archiveDir, `${fileType}.md`));
  } catch {
    // No prior file — skip archiving silently.
  }

  await writeFile(filePath, sanitizeResult.content, 'utf-8');

  if (taskId !== undefined) {
    await recordWorkflowFileMetadata(taskId, fileType, sanitizeResult.content, filePath);
  }

  return sanitizeResult.content;
}

/**
 * Upsert a row in the `WorkflowFile` metadata table so consumers can query
 * "which tasks have a stale plan?" without touching the filesystem.
 * Best-effort — failures are logged and swallowed.
 */
async function recordWorkflowFileMetadata(
  taskId: number,
  fileType: WorkflowFileType,
  content: string,
  absolutePath: string,
): Promise<void> {
  try {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    // Use a dynamic accessor so older builds without the `workflowFile` model
    // (pre-migration) do not crash here — the metadata is best-effort.
    const wf = (prisma as unknown as { workflowFile?: WorkflowFileDelegate }).workflowFile;
    if (!wf) return;
    await wf.upsert({
      where: { taskId_fileType: { taskId, fileType } },
      create: { taskId, fileType, sha256, sizeBytes, absolutePath },
      update: { sha256, sizeBytes, absolutePath, updatedAt: new Date() },
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'WorkflowFile metadata write failed',
    );
  }
}

interface WorkflowFileDelegate {
  upsert(args: {
    where: { taskId_fileType: { taskId: number; fileType: string } };
    create: {
      taskId: number;
      fileType: string;
      sha256: string;
      sizeBytes: number;
      absolutePath: string;
    };
    update: {
      sha256: string;
      sizeBytes: number;
      absolutePath: string;
      updatedAt: Date;
    };
  }): Promise<unknown>;
}

/**
 * Remove leftover workflow-related files from the project root.
 *
 * CLI agents sometimes write files to the project root instead of the proper
 * workflow directory. This cleanup runs after each CLI agent execution.
 *
 * @param taskId - The task ID (currently unused but retained for future logging). / タスクID
 */
export async function cleanupRootWorkflowFiles(_taskId: number): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const projectRoot = process.cwd();

  // File patterns to delete
  const workflowPatterns = [
    /^.*research.*\.md$/i,
    /^.*plan.*\.md$/i,
    /^.*verify.*\.md$/i,
    /^.*question.*\.md$/i,
    /^.*implementation.*\.md$/i,
    /^.*temp.*\.md$/i,
    /^.*research.*\.json$/i,
    /^.*verify.*\.json$/i,
    'implementation_verify.md',
    'temp_research.md',
    'research_content.json',
    'verify_content.md',
    'API_OPTIMIZATION_GUIDE.md',
    'SCREENSHOT_OPTIMIZATION_CHANGES.md',
  ];

  try {
    const files = await fs.promises.readdir(projectRoot);

    for (const file of files) {
      const filePath = path.join(projectRoot, file);
      const stat = await fs.promises.stat(filePath);

      // Skip directories
      if (stat.isDirectory()) continue;

      let shouldDelete = false;

      for (const pattern of workflowPatterns) {
        if (typeof pattern === 'string') {
          if (file === pattern) {
            shouldDelete = true;
            break;
          }
        } else if (pattern instanceof RegExp) {
          if (pattern.test(file)) {
            shouldDelete = true;
            break;
          }
        }
      }

      if (shouldDelete) {
        log.info(`[WorkflowFileUtils] Cleaning up root file: ${file}`);
        await fs.promises.unlink(filePath);
      }
    }
  } catch (error) {
    log.warn(`[WorkflowFileUtils] Cleanup error: ${error}`);
    // Warn only, do not throw
  }
}

/**
 * Extract Markdown content from CLI agent output.
 *
 * CLI agent output contains tool call logs ([Tool: ...], [Result: ...], etc.).
 * This function strips those logs and returns the actual Markdown content.
 *
 * @param output - Raw agent output string. / エージェントの生出力文字列
 * @param fileType - The expected file type (used for logging only). / 期待するファイルタイプ
 * @returns Extracted Markdown string or null if insufficient content. / 抽出されたMarkdownまたはnull
 */
export function extractMarkdownFromOutput(output: string, fileType: string): string | null {
  // Suppress unused-variable lint; fileType is retained for caller-side logging
  void fileType;

  const lines = output.split('\n');
  const contentLines: string[] = [];
  let inToolBlock = false;

  for (const line of lines) {
    if (line.match(/^\[Tool:\s/)) {
      inToolBlock = true;
      continue;
    }
    if (line.match(/^\[Result:\s/) || line.match(/^\[完了\]/) || line.match(/^\[フェーズ完了\]/)) {
      inToolBlock = false;
      continue;
    }
    // Skip spinner/status lines
    if (line.match(/^⏺|^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)) {
      continue;
    }
    if (!inToolBlock) {
      contentLines.push(line);
    }
  }

  const content = contentLines.join('\n').trim();

  if (content.length < 50) return null;
  if (!content.match(/^#+\s|^\-\s|^\*\s|^\d+\.\s/m)) {
    // If no Markdown structure found, fall back to the raw output when it looks like Markdown
    if (output.trim().length > 100 && output.match(/^#+\s|^\-\s|^\*\s/m)) {
      return output.trim();
    }
    return null;
  }

  return content;
}
