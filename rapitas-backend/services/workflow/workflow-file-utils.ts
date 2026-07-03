/**
 * Workflow File Utils
 *
 * Low-level filesystem helpers for reading, writing, and cleaning up workflow
 * Markdown files. Does not contain any business logic or DB access.
 */
import { readFile, writeFile, mkdir, rename, stat, rm } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { prisma } from '../../config';
import { sanitizeMarkdownContent } from '../../utils/common/mojibake-detector';
import { createLogger } from '../../config/logger';
import { getTaskWorkflowDir, getArchiveDir } from './workflow-paths';
import { resolveTaskWithThemeAndCategory } from '../task/task-resolver';
import { fileHypothesesFromResearch } from '../memory/hypothesis-from-research';
import { applyHypothesisVerdictsFromVerify } from '../memory/hypothesis-from-verify';

const log = createLogger('workflow-file-utils');

import type { WorkflowFileType } from './workflow-types';
export type { WorkflowFileType };

/**
 * Resolve the workflow directory path from a task ID.
 *
 * @param taskId - The task ID to resolve. / 解決するタスクID
 * @returns Directory info or null if the task does not exist. / タスクが存在しない場合はnull
 */
export async function resolveWorkflowDir(taskId: number) {
  const task = await resolveTaskWithThemeAndCategory(taskId);
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
 * Delete a task's workflow directory (research/plan/verify/question + archived
 * versions) from disk. Best-effort and recursive; a missing task/dir is a no-op.
 * MUST be called while the task still exists (resolveWorkflowDir reads it to
 * derive the category/theme path), i.e. before `prisma.task.delete`.
 *
 * @param taskId - Task whose workflow md files to remove. / 対象タスクID
 * @returns true when a directory removal was attempted. / 削除を試みたか
 */
export async function deleteWorkflowDir(taskId: number): Promise<boolean> {
  try {
    const resolved = await resolveWorkflowDir(taskId);
    if (!resolved) return false;
    await rm(resolved.dir, { recursive: true, force: true });
    log.info({ taskId, dir: resolved.dir }, '[workflow-file-utils] Deleted workflow dir');
    return true;
  } catch (err) {
    log.warn({ err, taskId }, '[workflow-file-utils] Failed to delete workflow dir');
    return false;
  }
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

  // Archive the previous version when present so users can compare iterations
  // (and so a regenerated plan never silently destroys the previous one).
  // NOTE: `stat` failing with ENOENT ("no prior file") is the only case that's
  // safe to skip silently. A bare `catch { }` around the WHOLE block used to
  // also swallow a real `mkdir`/`rename` failure (e.g. EBUSY/EPERM on a locked
  // file) identically — in that case the prior version was never actually
  // moved out of the way, yet the code fell straight through to `writeFile`
  // below and overwrote it anyway, permanently losing it. Only the "no prior
  // file" case is treated as a no-op; any other archiving failure aborts the
  // write instead of risking that data loss.
  const priorExists = await stat(filePath)
    .then(() => true)
    .catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        log.warn(
          { err, filePath },
          '[WorkflowFileUtils] stat failed before archiving (not "file missing") — treating as no prior file',
        );
      }
      return false;
    });

  if (priorExists) {
    try {
      const archiveDir = getArchiveDir(dir, new Date().toISOString());
      await mkdir(archiveDir, { recursive: true });
      await rename(filePath, join(archiveDir, `${fileType}.md`));
    } catch (err) {
      log.error(
        { err, filePath },
        '[WorkflowFileUtils] Failed to archive prior version — aborting write to avoid destroying it',
      );
      throw new Error(`Failed to archive prior ${fileType}.md before overwrite: ${String(err)}`);
    }
  }

  await writeFile(filePath, sanitizeResult.content, 'utf-8');

  if (taskId !== undefined) {
    await recordWorkflowFileMetadata(taskId, fileType, sanitizeResult.content, filePath);

    // Seed the agent-memory ledgers from the file's structured sections. This is
    // the UNIVERSAL save choke point — the auto-run path (workflow-cli-executor)
    // writes research/plan via this function directly, NOT through the
    // handleSaveFile API route, so hooks placed only in that route never fired
    // for auto-run tasks (the ledger stayed empty all day despite research
    // writing a valid `## 仮説` section). Fire-and-forget; submitHypothesis
    // dedupes (content hash), so the API path calling this in addition is safe.
    if (fileType === 'research') {
      void fileHypothesesFromResearch(taskId, sanitizeResult.content).catch(() => {});
    } else if (fileType === 'verify') {
      // Explicit verification closes the loop: graduate/refute hypotheses from the
      // verifier's `## 仮説評価` verdicts (real prediction-held judgement), not the
      // weak completion proxy that never crossed the graduation bar.
      void applyHypothesisVerdictsFromVerify(taskId, sanitizeResult.content).catch(() => {});
    }
  }

  return sanitizeResult.content;
}

/**
 * Move a workflow file into `_archive/<ts>/` so a later phase cannot reuse it.
 * Used when an artifact is rejected (e.g. a log-polluted plan.md on replan): the
 * producing phase then regenerates from scratch instead of re-reading the bad
 * file and looping. Best-effort; a missing file is a no-op.
 *
 * @param dir - Workflow directory. / ワークフローディレクトリ
 * @param fileType - Artifact to archive. / 退避するファイル種別
 * @returns true when a file was archived. / 退避した場合 true
 */
export async function archiveWorkflowFile(
  dir: string,
  fileType: WorkflowFileType,
): Promise<boolean> {
  const filePath = join(dir, `${fileType}.md`);
  try {
    await stat(filePath);
    const archiveDir = getArchiveDir(dir, new Date().toISOString());
    await mkdir(archiveDir, { recursive: true });
    await rename(filePath, join(archiveDir, `${fileType}.md`));
    return true;
  } catch {
    return false;
  }
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
 * The canonical report heading per workflow file type. We slice the agent's
 * output from the LAST occurrence of this heading so any execution-log preamble
 * (status lines, tool dumps, error stack traces, "Uncaught ReferenceError: …")
 * is dropped wholesale — the report is the first byte of what we persist.
 */
const REPORT_HEADERS: Partial<Record<string, RegExp>> = {
  research: /^#\s+(調査レポート|research report)\s*$/gim,
  verify: /^#\s+(検証レポート|verification report)\s*$/gim,
  plan: /^#\s+(実装計画|計画|implementation plan)\s*$/gim,
  question: /^#\s+(レビュー(指摘)?|review(\s+feedback)?)\s*$/gim,
};

/** ANSI/VT escape sequences (colours, cursor moves) emitted by CLI agents. */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Line-level noise emitted by CLI agents that must never reach a workflow .md.
 * Conservative: every pattern is anchored at line-start and targets a log shape,
 * not prose, so legitimate report lines (which may *mention* "error") survive.
 */
const NOISE_LINE_RES: RegExp[] = [
  /^[⏺•·]?\s*\[(Tool|Result|完了|フェーズ完了|ExecLog|smoke)[:\]]/i, // tool/exec markers
  /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⏺]/, // spinner glyphs
  /^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}.*\]\s*(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)/i, // pino-style timestamped log
  /^(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b[:\s]/, // bare level-prefixed log line
  /^\s*at\s+.+:\d+:\d+\)?\s*$/, // JS stack-trace frame
  /^\s*at\s+(async\s+)?[\w.$<>[\] ]+\s*$/, // stack frame without location
  /^(Uncaught\s+)?(Reference|Type|Syntax|Range|Eval|URI)Error\b/, // thrown-error header
  /^\s*(node:internal\/|file:\/\/\/|\s+--\>\s)/, // node internals / prisma error arrows
];

/**
 * Whether a piece of text reads as an agent execution log rather than a report.
 * Used by the quality gate to reject contaminated content outright.
 *
 * @param text - Candidate markdown body. / 判定対象テキスト
 * @returns true when it looks like a raw log dump. / ログダンプと見なせる場合 true
 */
export function looksLikeAgentLog(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;
  const noisy = lines.filter((l) => NOISE_LINE_RES.some((re) => re.test(l))).length;
  // A genuine report is overwhelmingly prose/markdown; >25% noise lines == a log.
  return noisy / lines.length > 0.25;
}

/**
 * Slice off any conversational/log preamble that precedes the report body.
 *
 * Slices from the LAST canonical heading for `fileType` when present; otherwise
 * falls back to the FIRST Markdown heading so a chat preamble the agent prepended
 * (e.g. "これで必要な調査が完了しました。以下がresearch.mdです。") is dropped even
 * when the heading is non-standard. Returns the input unchanged when no heading
 * is found, so genuinely heading-less content is left for the caller to judge.
 *
 * @param text - Candidate report text (ANSI already stripped). / 判定対象テキスト
 * @param fileType - Workflow file type selecting the canonical heading. / ファイル種別
 * @returns Text from the report heading onward. / 見出し以降のテキスト
 */
export function sliceFromReportHeading(text: string, fileType: string): string {
  const headerRe = REPORT_HEADERS[fileType];
  if (headerRe) {
    headerRe.lastIndex = 0;
    let lastIndex = -1;
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(text)) !== null) lastIndex = m.index;
    if (lastIndex >= 0) return text.slice(lastIndex);
  }
  const firstHeading = text.match(/^#{1,6}\s+\S/m);
  if (firstHeading?.index) return text.slice(firstHeading.index);
  return text;
}

/**
 * Extract a clean Markdown report from raw CLI/API agent output.
 *
 * The agent's stdout/finalMessage can be polluted with execution logs (tool
 * dumps, spinners, ANSI colours, log lines, and crash stack traces such as
 * "Uncaught ReferenceError: Workflow is not defined"). Persisting that into a
 * workflow .md corrupts the artifact that the whole pipeline depends on. This:
 *   1. strips ANSI escapes,
 *   2. slices from the LAST canonical report heading for `fileType` (dropping
 *      any log preamble entirely), and
 *   3. removes residual noise lines, then
 *   4. QUALITY-GATES the result — returning null (so the caller writes NO file)
 *      when what's left is too short, has no Markdown structure, or still reads
 *      as a log. A missing file fails the phase cleanly; a contaminated file
 *      would silently poison every downstream consumer.
 *
 * @param output - Raw agent output string. / エージェントの生出力文字列
 * @param fileType - The workflow file type, selects the report heading. / ワークフローファイル種別
 * @returns Clean Markdown, or null when the output is not a usable report. / 整形済みMarkdown、使用不可ならnull
 */
export function extractMarkdownFromOutput(output: string, fileType: string): string | null {
  if (!output) return null;
  let text = output.replace(/\r\n/g, '\n').replace(ANSI_RE, '');

  // 1) Slice off any preamble before the report body (the strongest defense).
  text = sliceFromReportHeading(text, fileType);

  // 2) Drop residual tool/log/spinner/stack-trace lines.
  const contentLines = text
    .split('\n')
    .filter((line) => !NOISE_LINE_RES.some((re) => re.test(line)));
  const content = contentLines.join('\n').trim();

  // 3) Quality gate — reject anything that isn't a substantive Markdown report.
  // Length is a coarse floor; structure + log-shape are the real discriminators
  // (a tiny crash residue has neither a heading nor low noise).
  if (content.length < 40) return null;
  if (!/^#+\s|^[-*]\s|^\d+\.\s/m.test(content)) return null;
  if (looksLikeAgentLog(content)) return null;

  return content;
}
