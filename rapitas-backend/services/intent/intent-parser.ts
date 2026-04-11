/**
 * IntentParser
 *
 * Parses .intent files (YAML-like declarative format) into structured task data.
 * Intent files describe WHAT the system should do, not HOW.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('intent-parser');

/** Parsed intent structure. */
export type ParsedIntent = {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedHours?: number;
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  workflow: {
    mode: 'lightweight' | 'standard' | 'comprehensive';
    autoApprove: boolean;
  };
  hints?: string[];
  dependencies?: string[];
  tags?: string[];
};

/** Parse result with validation info. */
export type IntentParseResult = {
  success: boolean;
  intent?: ParsedIntent;
  errors: string[];
  warnings: string[];
};

/**
 * Parse an intent file content string into structured data.
 * Supports a simple section-based format with @-prefixed directives.
 *
 * @param content - Raw intent file content / インテントファイルの生テキスト
 * @returns Parse result with intent data or errors / パース結果
 */
export function parseIntentFile(content: string): IntentParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content.trim()) {
    return { success: false, errors: ['Intent file is empty'], warnings };
  }

  const lines = content.split('\n');
  let currentSection = '';
  const sections: Record<string, string[]> = {};
  const keyValues: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Section headers: @goals, @constraints, etc.
    if (line.startsWith('@')) {
      currentSection = line
        .slice(1)
        .toLowerCase()
        .replace(/[:：\s]+$/, '');
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }

    // Key-value pairs in sections: "title: My Task"
    const kvMatch = line.match(/^(\w+)\s*[:：]\s*(.+)$/);
    if (kvMatch && !currentSection) {
      keyValues[kvMatch[1].toLowerCase()] = kvMatch[2].trim();
      continue;
    }

    // List items: "- item" or "* item"
    if ((line.startsWith('-') || line.startsWith('*')) && currentSection) {
      sections[currentSection].push(line.replace(/^[-*]\s*/, '').trim());
      continue;
    }

    // Bare text in a section
    if (currentSection && line.length > 0) {
      sections[currentSection].push(line);
    } else if (!currentSection && !kvMatch) {
      // Bare text before any section — treat as title if no title set
      if (!keyValues['title']) {
        keyValues['title'] = line;
      }
    }
  }

  // Extract title
  const title = keyValues['title'] || sections['title']?.[0];
  if (!title) {
    errors.push('title is required');
  }

  // Extract priority
  const rawPriority = keyValues['priority']?.toLowerCase();
  const priority = (
    ['low', 'medium', 'high', 'urgent'].includes(rawPriority || '') ? rawPriority : 'medium'
  ) as ParsedIntent['priority'];

  // Extract estimated hours
  const estimatedHours = keyValues['hours'] || keyValues['estimatedhours'] || keyValues['estimate'];
  const hours = estimatedHours ? parseFloat(estimatedHours) : undefined;

  // Extract workflow settings
  const rawMode = keyValues['mode'] || keyValues['workflow'];
  const mode = (
    ['lightweight', 'standard', 'comprehensive'].includes(rawMode || '') ? rawMode : undefined
  ) as ParsedIntent['workflow']['mode'] | undefined;

  const autoApprove = keyValues['autoapprove'] === 'true' || keyValues['auto_approve'] === 'true';

  // Goals
  const goals = sections['goals'] || sections['goal'] || [];
  if (goals.length === 0) {
    warnings.push('No @goals defined — consider adding explicit goals');
  }

  // Constraints
  const constraints = sections['constraints'] || sections['constraint'] || sections['rules'] || [];

  // Acceptance criteria
  const acceptance =
    sections['acceptance'] ||
    sections['acceptancecriteria'] ||
    sections['criteria'] ||
    sections['done'] ||
    [];

  // Hints
  const hints = sections['hints'] || sections['hint'] || sections['tips'] || [];

  // Dependencies
  const dependencies =
    sections['dependencies'] || sections['depends'] || sections['requires'] || [];

  // Tags
  const tags = sections['tags'] || sections['labels'] || [];

  // Description: combine description section or key-value
  const descriptionParts: string[] = [];
  if (keyValues['description']) descriptionParts.push(keyValues['description']);
  if (sections['description']) descriptionParts.push(...sections['description']);

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  // Auto-detect complexity for workflow mode
  const autoMode = !mode
    ? goals.length <= 2 && constraints.length === 0
      ? 'lightweight'
      : goals.length <= 5
        ? 'standard'
        : 'comprehensive'
    : mode;

  const intent: ParsedIntent = {
    title: title!,
    description: descriptionParts.length > 0 ? descriptionParts.join('\n') : undefined,
    priority,
    estimatedHours: hours,
    goals,
    constraints,
    acceptanceCriteria: acceptance,
    workflow: {
      mode: autoMode as ParsedIntent['workflow']['mode'],
      autoApprove,
    },
    hints: hints.length > 0 ? hints : undefined,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    tags: tags.length > 0 ? tags : undefined,
  };

  log.info(
    `[IntentParser] Parsed intent: "${title}" (${goals.length} goals, ${constraints.length} constraints, mode: ${autoMode})`,
  );

  return { success: true, intent, errors, warnings };
}

/**
 * Export a task back to intent file format (reverse compilation).
 *
 * @param task - Task data / タスクデータ
 * @param workflowFiles - Workflow file contents / ワークフローファイルの内容
 * @returns Intent file content / インテントファイルの内容
 */
export function exportToIntentFormat(
  task: {
    title: string;
    description?: string | null;
    priority?: string;
    estimatedHours?: number | null;
    workflowMode?: string | null;
  },
  workflowFiles?: {
    plan?: string | null;
    verify?: string | null;
  },
): string {
  const lines: string[] = [];

  lines.push(`title: ${task.title}`);
  if (task.priority) lines.push(`priority: ${task.priority}`);
  if (task.estimatedHours) lines.push(`hours: ${task.estimatedHours}`);
  if (task.workflowMode) lines.push(`mode: ${task.workflowMode}`);
  lines.push('');

  if (task.description) {
    lines.push('@description');
    lines.push(task.description);
    lines.push('');
  }

  // Extract goals from plan.md checklist
  if (workflowFiles?.plan) {
    const planItems = workflowFiles.plan.match(/- \[[ xX]\]\s*(.+)/g);
    if (planItems && planItems.length > 0) {
      lines.push('@goals');
      for (const item of planItems) {
        lines.push(`- ${item.replace(/- \[[ xX]\]\s*/, '')}`);
      }
      lines.push('');
    }
  }

  // Extract acceptance criteria from verify.md
  if (workflowFiles?.verify) {
    const verifyItems = workflowFiles.verify.match(/- \[[ xX]\]\s*(.+)/g);
    if (verifyItems && verifyItems.length > 0) {
      lines.push('@acceptance');
      for (const item of verifyItems) {
        lines.push(`- ${item.replace(/- \[[ xX]\]\s*/, '')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
