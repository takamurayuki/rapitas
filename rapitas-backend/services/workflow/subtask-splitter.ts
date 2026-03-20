/**
 * SubtaskSplitter
 *
 * Analyzes plan.md content to determine if a task should be split into subtasks.
 * Creates subtasks in DB with proper dependency ordering and generates
 * instruction.md files for each subtask.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const log = createLogger('subtask-splitter');

/** Thresholds for when to split a task into subtasks. */
const SPLIT_THRESHOLDS = {
  MIN_FILES: 8,
  MIN_LINES: 500,
  MIN_CHECKLIST_ITEMS: 10,
  MIN_INDEPENDENT_GROUPS: 3,
};

/** Parsed subtask from plan analysis. */
type PlannedSubtask = {
  order: number;
  title: string;
  scope: string[];
  instructions: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  dependsOn: number[];
  parallelizable: boolean;
  estimatedFiles: number;
};

/** Result of the split analysis. */
export type SplitAnalysis = {
  shouldSplit: boolean;
  reason: string;
  metrics: {
    fileCount: number;
    checklistItems: number;
    estimatedLines: number;
    independentGroups: number;
  };
  subtasks: PlannedSubtask[];
};

/** Result of subtask creation. */
export type SplitResult = {
  success: boolean;
  parentTaskId: number;
  subtasksCreated: number;
  subtaskIds: number[];
  error?: string;
};

/**
 * Analyze a plan.md to determine if the task should be split.
 *
 * @param planContent - The plan.md content / plan.mdの内容
 * @returns Split analysis with recommended subtasks / 分割分析結果
 */
export function analyzePlanForSplitting(planContent: string): SplitAnalysis {
  const lines = planContent.split('\n');

  // Count checklist items
  const checklistItems = lines.filter((l) => /^\s*- \[[ xX]\]/.test(l));

  // Extract file references
  const filePattern = /[\w\-./]+\.[a-zA-Z]{1,10}/g;
  const allFiles = new Set<string>();
  for (const line of lines) {
    const matches = line.match(filePattern) || [];
    for (const m of matches) {
      if (m.includes('/') && !m.match(/^v?\d+\.\d+/)) {
        allFiles.add(m);
      }
    }
  }

  // Estimate lines changed (heuristic: 50 lines per checklist item)
  const estimatedLines = checklistItems.length * 50;

  // Detect independent groups (sections with ## headers)
  const sectionHeaders = lines.filter((l) => /^##\s+/.test(l) && !/summary|risk|done|definition/i.test(l));
  const independentGroups = sectionHeaders.length;

  const metrics = {
    fileCount: allFiles.size,
    checklistItems: checklistItems.length,
    estimatedLines,
    independentGroups,
  };

  const shouldSplit =
    allFiles.size >= SPLIT_THRESHOLDS.MIN_FILES ||
    estimatedLines >= SPLIT_THRESHOLDS.MIN_LINES ||
    checklistItems.length >= SPLIT_THRESHOLDS.MIN_CHECKLIST_ITEMS ||
    independentGroups >= SPLIT_THRESHOLDS.MIN_INDEPENDENT_GROUPS;

  const reasons: string[] = [];
  if (allFiles.size >= SPLIT_THRESHOLDS.MIN_FILES) reasons.push(`${allFiles.size} files`);
  if (checklistItems.length >= SPLIT_THRESHOLDS.MIN_CHECKLIST_ITEMS) reasons.push(`${checklistItems.length} checklist items`);
  if (estimatedLines >= SPLIT_THRESHOLDS.MIN_LINES) reasons.push(`~${estimatedLines} estimated lines`);
  if (independentGroups >= SPLIT_THRESHOLDS.MIN_INDEPENDENT_GROUPS) reasons.push(`${independentGroups} independent groups`);

  // Extract subtask groups from plan structure
  const subtasks = shouldSplit ? extractSubtasksFromPlan(planContent, [...allFiles]) : [];

  return {
    shouldSplit,
    reason: shouldSplit
      ? `Split recommended: ${reasons.join(', ')}`
      : 'Task is small enough for single execution',
    metrics,
    subtasks,
  };
}

/**
 * Create subtasks in DB and generate instruction.md files.
 *
 * @param parentTaskId - Parent task ID / 親タスクID
 * @param analysis - Split analysis result / 分割分析結果
 * @param researchContent - Research.md content to include in context / research.mdの内容
 * @returns Creation result / 作成結果
 */
export async function createSubtasksFromPlan(
  parentTaskId: number,
  analysis: SplitAnalysis,
  researchContent?: string,
): Promise<SplitResult> {
  if (!analysis.shouldSplit || analysis.subtasks.length === 0) {
    return { success: false, parentTaskId, subtasksCreated: 0, subtaskIds: [], error: 'No split needed' };
  }

  try {
    const parentTask = await prisma.task.findUnique({
      where: { id: parentTaskId },
      include: { theme: { include: { category: true } } },
    });

    if (!parentTask) {
      return { success: false, parentTaskId, subtasksCreated: 0, subtaskIds: [], error: 'Parent task not found' };
    }

    const subtaskIds: number[] = [];

    for (const planned of analysis.subtasks) {
      // Create subtask in DB
      const subtask = await prisma.task.create({
        data: {
          title: planned.title,
          description: planned.scope.join('\n'),
          parentId: parentTaskId,
          themeId: parentTask.themeId,
          priority: parentTask.priority,
          status: 'todo',
          isDeveloperMode: true,
          workflowMode: 'lightweight',
          autoApprovePlan: true,
          estimatedHours: planned.estimatedFiles * 0.5,
        },
      });

      subtaskIds.push(subtask.id);

      // Create subtask workflow directory with instruction.md
      const categoryDir = parentTask.theme?.categoryId ? String(parentTask.theme.categoryId) : '0';
      const themeDir = parentTask.themeId ? String(parentTask.themeId) : '0';
      const parentDir = join(process.cwd(), 'tasks', categoryDir, themeDir, String(parentTaskId));
      const subtaskDir = join(parentDir, 'subtasks', `${String(planned.order).padStart(2, '0')}-${sanitizeDirName(planned.title)}`);

      await mkdir(subtaskDir, { recursive: true });

      // Build instruction.md
      const instructionContent = buildInstructionMd(planned, researchContent, subtaskIds.slice(0, -1));
      await writeFile(join(subtaskDir, 'instruction.md'), instructionContent, 'utf-8');

      log.info(`[SubtaskSplitter] Created subtask #${subtask.id}: "${planned.title}" (order: ${planned.order})`);
    }

    // Update parent task with subtask count info
    await prisma.task.update({
      where: { id: parentTaskId },
      data: {
        description: (parentTask.description || '') +
          `\n\n---\n**Auto-split into ${subtaskIds.length} subtasks**: ${subtaskIds.map((id) => `#${id}`).join(', ')}`,
      },
    });

    log.info(`[SubtaskSplitter] Split task #${parentTaskId} into ${subtaskIds.length} subtasks`);

    return {
      success: true,
      parentTaskId,
      subtasksCreated: subtaskIds.length,
      subtaskIds,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, `[SubtaskSplitter] Failed to create subtasks for task #${parentTaskId}`);
    return { success: false, parentTaskId, subtasksCreated: 0, subtaskIds: [], error: msg };
  }
}

/**
 * Extract subtask groups from plan content based on sections and checklist grouping.
 */
function extractSubtasksFromPlan(planContent: string, allFiles: string[]): PlannedSubtask[] {
  const lines = planContent.split('\n');
  const subtasks: PlannedSubtask[] = [];

  let currentSection = '';
  let currentItems: string[] = [];
  let currentFiles: string[] = [];
  let order = 0;

  for (const line of lines) {
    // Detect section headers as subtask boundaries
    if (/^##\s+/.test(line) && !/summary|risk|done|definition|task/i.test(line)) {
      if (currentSection && currentItems.length > 0) {
        order++;
        subtasks.push(buildPlannedSubtask(order, currentSection, currentItems, currentFiles, allFiles));
      }
      currentSection = line.replace(/^##\s+/, '').trim();
      currentItems = [];
      currentFiles = [];
      continue;
    }

    if (/^\s*- \[[ xX]\]/.test(line)) {
      currentItems.push(line.replace(/^\s*- \[[ xX]\]\s*/, '').trim());

      // Extract files mentioned in this checklist item
      const fileMatches = line.match(/[\w\-./]+\.[a-zA-Z]{1,10}/g) || [];
      for (const f of fileMatches) {
        if (f.includes('/') && !currentFiles.includes(f)) {
          currentFiles.push(f);
        }
      }
    }
  }

  // Last section
  if (currentSection && currentItems.length > 0) {
    order++;
    subtasks.push(buildPlannedSubtask(order, currentSection, currentItems, currentFiles, allFiles));
  }

  // If no sections detected, split by file groups (max 5 files per subtask)
  if (subtasks.length === 0 && allFiles.length >= SPLIT_THRESHOLDS.MIN_FILES) {
    const chunkSize = 5;
    for (let i = 0; i < allFiles.length; i += chunkSize) {
      order++;
      const chunk = allFiles.slice(i, i + chunkSize);
      subtasks.push({
        order,
        title: `Batch ${order}: ${chunk[0].split('/').pop() || 'files'} and related`,
        scope: chunk,
        instructions: [`Modify the following files: ${chunk.join(', ')}`],
        constraints: ['Do not modify files outside this batch scope'],
        acceptanceCriteria: ['All modified files compile without errors', 'Existing tests pass'],
        dependsOn: order > 1 ? [order - 1] : [],
        parallelizable: false,
        estimatedFiles: chunk.length,
      });
    }
  }

  // Detect parallelizable subtasks (no shared files)
  for (let i = 0; i < subtasks.length; i++) {
    const filesI = new Set(subtasks[i].scope);
    subtasks[i].parallelizable = true;
    for (let j = 0; j < i; j++) {
      const hasOverlap = subtasks[j].scope.some((f) => filesI.has(f));
      if (hasOverlap) {
        subtasks[i].parallelizable = false;
        if (!subtasks[i].dependsOn.includes(subtasks[j].order)) {
          subtasks[i].dependsOn.push(subtasks[j].order);
        }
      }
    }
  }

  return subtasks;
}

function buildPlannedSubtask(
  order: number,
  section: string,
  items: string[],
  files: string[],
  _allFiles: string[],
): PlannedSubtask {
  return {
    order,
    title: section,
    scope: files,
    instructions: items,
    constraints: ['Do not modify files outside this subtask scope'],
    acceptanceCriteria: ['All changes compile without errors', 'Existing tests pass'],
    dependsOn: order > 1 ? [order - 1] : [],
    parallelizable: false,
    estimatedFiles: Math.max(files.length, 1),
  };
}

function buildInstructionMd(
  planned: PlannedSubtask,
  researchContent?: string,
  previousSubtaskIds?: number[],
): string {
  const lines: string[] = [];

  lines.push(`# Subtask ${String(planned.order).padStart(2, '0')}: ${planned.title}`);
  lines.push('');

  lines.push('## Context');
  if (researchContent) {
    // Include first 500 chars of research as context
    lines.push(researchContent.slice(0, 500));
  }
  if (previousSubtaskIds && previousSubtaskIds.length > 0) {
    lines.push(`\nPrevious subtasks: ${previousSubtaskIds.map((id) => `#${id}`).join(', ')}`);
  }
  if (planned.dependsOn.length > 0) {
    lines.push(`Dependencies: subtask ${planned.dependsOn.map((d) => `#${d}`).join(', ')}`);
  }
  lines.push('');

  lines.push('## Scope');
  if (planned.scope.length > 0) {
    lines.push('Target files:');
    for (const f of planned.scope) {
      lines.push(`- ${f}`);
    }
  }
  lines.push('');

  lines.push('## Instructions');
  for (let i = 0; i < planned.instructions.length; i++) {
    lines.push(`${i + 1}. ${planned.instructions[i]}`);
  }
  lines.push('');

  if (planned.constraints.length > 0) {
    lines.push('## Constraints');
    for (const c of planned.constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  lines.push('## Acceptance Criteria');
  for (const a of planned.acceptanceCriteria) {
    lines.push(`- [ ] ${a}`);
  }

  return lines.join('\n');
}

function sanitizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}
