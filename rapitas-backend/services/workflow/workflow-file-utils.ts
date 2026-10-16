/**
 * Workflow File Utils
 *
 * DB-backed helpers for reading, writing, and versioning workflow Markdown
 * artifacts (research/plan/question/verify). The `WorkflowFile` row IS the
 * content — there is no on-disk mirror for anything written through this
 * module. Superseded versions live in `WorkflowFileVersion` instead of the
 * old `_archive/<timestamp>/` folder convention.
 */
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { prisma } from '../../config';
import { sanitizeMarkdownContent } from '../../utils/common/mojibake-detector';
import { createLogger } from '../../config/logger';
import { getTaskWorkflowDir } from './workflow-paths';
import { resolveTaskWithThemeAndCategory } from '../task/task-resolver';
import { fileHypothesesFromResearch } from '../memory/hypothesis-from-research';
import { applyHypothesisVerdictsFromVerify } from '../memory/hypothesis-from-verify';

const log = createLogger('workflow-file-utils');

import type { WorkflowFileType } from './workflow-types';
export type { WorkflowFileType };

/**
 * Resolve a task's identity (task row + category/theme ids) for workflow-file
 * operations.
 *
 * @param taskId - The task ID to resolve. / 解決するタスクID
 * @returns Task identity or null if the task does not exist. / タスクが存在しない場合はnull
 */
export async function resolveWorkflowDir(taskId: number) {
  const task = await resolveTaskWithThemeAndCategory(taskId);
  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;
  return { task, categoryId, themeId };
}

/**
 * Reads a legacy on-disk workflow file, if present. ONLY used as a transient
 * fallback for the window between server startup and
 * `workflow-db-backfill.ts` completing — once every task's file has been
 * backfilled into `WorkflowFile`, this never matches anything.
 */
async function readLegacyFileFallback(
  taskId: number,
  fileType: WorkflowFileType,
): Promise<string | null> {
  const resolved = await resolveWorkflowDir(taskId).catch(() => null);
  if (!resolved) return null;
  const dir = getTaskWorkflowDir(resolved.categoryId, resolved.themeId, taskId);
  try {
    return await readFile(join(dir, `${fileType}.md`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read the content of a workflow file.
 *
 * @param taskId - Task the artifact belongs to. / 対象タスクID
 * @param fileType - The workflow file type to read. / 読み込むワークフローファイルの種類
 * @returns File content string or null if not found. / ファイル内容またはnull
 */
export async function readWorkflowFile(
  taskId: number,
  fileType: WorkflowFileType,
): Promise<string | null> {
  const row = await prisma.workflowFile
    .findUnique({
      where: { taskId_fileType: { taskId, fileType } },
      select: { content: true },
    })
    .catch(() => null);
  if (row) return row.content;

  // Transient backfill-race fallback (see readLegacyFileFallback doc comment).
  const legacyContent = await readLegacyFileFallback(taskId, fileType);
  if (legacyContent != null) {
    await writeWorkflowFile(taskId, fileType, legacyContent).catch((err) => {
      log.warn(
        { err, taskId, fileType },
        '[WorkflowFileUtils] Failed to write through legacy fallback',
      );
    });
    return legacyContent;
  }
  return null;
}

/**
 * Write a workflow file, applying mojibake correction before saving. Any
 * existing content is archived into `WorkflowFileVersion` first so a
 * regenerated plan never silently destroys the previous version.
 *
 * @param taskId - Task the artifact belongs to. / 対象タスクID
 * @param fileType - The workflow file type to write. / 書き込むワークフローファイルの種類
 * @param content - Markdown content to write. / 書き込むMarkdownコンテンツ
 * @returns The sanitized content actually saved. / 実際に保存したサニタイズ済みコンテンツ
 */
/** Error thrown when a split parent's verify.md is saved with open subtasks. */
export class OpenSubtasksError extends Error {
  constructor(openIds: number[]) {
    super(
      `verify.md rejected: parent task has non-terminal subtasks (#${openIds.join(', #')}). ` +
        `Parent completion is driven by subtask-completion-handler once every subtask is terminal.`,
    );
    this.name = 'OpenSubtasksError';
  }
}

export async function writeWorkflowFile(
  taskId: number,
  fileType: WorkflowFileType,
  content: string,
): Promise<string> {
  // Split-parent guard at the UNIVERSAL choke point. The HTTP save route has
  // the same check (with a friendlier 400), but executor harvests and service
  // paths call this function directly — task 541 completed as a parent with
  // two 'todo' subtasks because the verifier's final message was harvested
  // straight through here, bypassing the route guard.
  if (fileType === 'verify') {
    const TERMINAL = new Set(['done', 'failed', 'cancelled', 'archived']);
    const subtasks = await prisma.task
      .findMany({ where: { parentId: taskId }, select: { id: true, status: true } })
      .catch(() => []);
    const openIds = subtasks.filter((s) => !TERMINAL.has(s.status)).map((s) => s.id);
    if (openIds.length > 0) {
      log.warn(
        { taskId, openIds },
        '[WorkflowFileUtils] Rejected verify.md write: parent has non-terminal subtasks',
      );
      const { recordTransition } = await import('./transition-recorder');
      await recordTransition({
        taskId,
        fromStatus: 'in_progress',
        toStatus: 'in_progress',
        actor: 'system',
        cause: 'verify_blocked_incomplete_subtasks',
        phase: 'verify',
        metadata: { openSubtaskIds: openIds, source: 'writeWorkflowFile' },
        invariantViolation: true,
        invariantMessage: `verify.md rejected at choke point: ${openIds.length} subtasks not terminal`,
      }).catch(() => {});
      throw new OpenSubtasksError(openIds);
    }
  }

  const sanitizeResult = sanitizeMarkdownContent(content);
  if (sanitizeResult.wasFixed) {
    log.info(
      { issues: sanitizeResult.issues },
      `[WorkflowFileUtils] Fixed mojibake in ${fileType}.md`,
    );
  }

  const sha256 = createHash('sha256').update(sanitizeResult.content).digest('hex');
  const sizeBytes = Buffer.byteLength(sanitizeResult.content, 'utf-8');

  await prisma.$transaction(async (tx) => {
    const existing = await tx.workflowFile.findUnique({
      where: { taskId_fileType: { taskId, fileType } },
    });
    if (existing) {
      await tx.workflowFileVersion.create({
        data: {
          taskId,
          fileType,
          content: existing.content,
          sha256: existing.sha256,
          sizeBytes: existing.sizeBytes,
        },
      });
    }
    await tx.workflowFile.upsert({
      where: { taskId_fileType: { taskId, fileType } },
      create: { taskId, fileType, content: sanitizeResult.content, sha256, sizeBytes },
      update: { content: sanitizeResult.content, sha256, sizeBytes },
    });
  });

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

  return sanitizeResult.content;
}

/**
 * Move a workflow file's content into `WorkflowFileVersion` and clear the
 * live row, so a later phase cannot reuse it. Used when an artifact is
 * rejected (e.g. a log-polluted plan.md on replan): the producing phase then
 * regenerates from scratch instead of re-reading the bad content and looping.
 * Best-effort; a missing row is a no-op.
 *
 * @param taskId - Task the artifact belongs to. / 対象タスクID
 * @param fileType - Artifact to archive. / 退避するファイル種別
 * @returns true when a row was archived. / 退避した場合 true
 */
export async function archiveWorkflowFile(
  taskId: number,
  fileType: WorkflowFileType,
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.workflowFile.findUnique({
        where: { taskId_fileType: { taskId, fileType } },
      });
      if (!existing) return false;
      await tx.workflowFileVersion.create({
        data: {
          taskId,
          fileType,
          content: existing.content,
          sha256: existing.sha256,
          sizeBytes: existing.sizeBytes,
        },
      });
      await tx.workflowFile.delete({ where: { taskId_fileType: { taskId, fileType } } });
      return true;
    });
  } catch (err) {
    log.warn({ err, taskId, fileType }, '[WorkflowFileUtils] Failed to archive workflow file');
    return false;
  }
}

/**
 * Remove leftover workflow-related files from the project root.
 *
 * CLI agents sometimes write files to the project root instead of saving via
 * the workflow API. This cleanup runs after each CLI agent execution.
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
