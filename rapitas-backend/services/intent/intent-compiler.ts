/**
 * IntentCompiler
 *
 * Compiles a parsed intent into task creation data, pre-filled workflow files,
 * and prompt directives. This is the "intent → implementation" bridge.
 */
import { createLogger } from '../../config/logger';
import type { ParsedIntent } from './intent-parser';

const log = createLogger('intent-compiler');

/** Compiled output ready for task creation and workflow bootstrapping. */
export type CompiledIntent = {
  /** Fields for prisma.task.create() */
  taskData: {
    title: string;
    description: string;
    priority: string;
    estimatedHours?: number;
    workflowMode: string;
    autoApprovePlan: boolean;
    autoApprove: boolean;
  };
  /** Pre-filled plan.md content. */
  planContent: string;
  /** Pre-filled research.md content (from constraints + dependencies). */
  researchContent: string;
  /** Acceptance criteria compiled into verify.md template. */
  verifyTemplate: string;
  /** Optimized prompt with goals/constraints injected. */
  compiledPrompt: string;
  /** Labels/tags to apply. */
  tags: string[];
};

/**
 * Compile a parsed intent into all artifacts needed for task execution.
 *
 * @param intent - Parsed intent / パース済みインテント
 * @returns Compiled artifacts / コンパイル済みアーティファクト
 */
export function compileIntent(intent: ParsedIntent): CompiledIntent {
  log.info(`[IntentCompiler] Compiling intent: "${intent.title}"`);

  const description = buildDescription(intent);
  const planContent = buildPlan(intent);
  const researchContent = buildResearch(intent);
  const verifyTemplate = buildVerifyTemplate(intent);
  const compiledPrompt = buildPrompt(intent);

  return {
    taskData: {
      title: intent.title,
      description,
      priority: intent.priority,
      estimatedHours: intent.estimatedHours,
      workflowMode: intent.workflow.mode,
      autoApprovePlan: intent.workflow.autoApprove,
      autoApprove: intent.workflow.autoApprove,
    },
    planContent,
    researchContent,
    verifyTemplate,
    compiledPrompt,
    tags: intent.tags || [],
  };
}

function buildDescription(intent: ParsedIntent): string {
  const parts: string[] = [];

  if (intent.description) {
    parts.push(intent.description);
  }

  if (intent.goals.length > 0) {
    parts.push('\n## Goals');
    for (const goal of intent.goals) {
      parts.push(`- ${goal}`);
    }
  }

  if (intent.constraints.length > 0) {
    parts.push('\n## Constraints');
    for (const c of intent.constraints) {
      parts.push(`- ${c}`);
    }
  }

  return parts.join('\n');
}

function buildPlan(intent: ParsedIntent): string {
  const lines: string[] = [];

  lines.push(`# Implementation Plan: ${intent.title}`);
  lines.push('');
  lines.push('## Task Summary');
  lines.push(intent.description || intent.title);
  lines.push('');

  lines.push('## Implementation Checklist');
  for (const goal of intent.goals) {
    lines.push(`- [ ] ${goal}`);
  }
  lines.push('');

  if (intent.constraints.length > 0) {
    lines.push('## Constraints');
    for (const c of intent.constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (intent.hints && intent.hints.length > 0) {
    lines.push('## Implementation Hints');
    for (const h of intent.hints) {
      lines.push(`- ${h}`);
    }
    lines.push('');
  }

  lines.push('## Risk Assessment');
  lines.push('- Intent-driven generation — verify output matches declared goals');
  lines.push('');

  lines.push('## Definition of Done');
  if (intent.acceptanceCriteria.length > 0) {
    for (const a of intent.acceptanceCriteria) {
      lines.push(`- [ ] ${a}`);
    }
  } else {
    lines.push('- [ ] All goals implemented');
    lines.push('- [ ] All constraints respected');
    lines.push('- [ ] Tests pass');
  }

  return lines.join('\n');
}

function buildResearch(intent: ParsedIntent): string {
  const lines: string[] = [];

  lines.push(`# Research: ${intent.title}`);
  lines.push('');
  lines.push('## Intent-Driven Analysis');
  lines.push(`This task was created from a declarative intent file.`);
  lines.push('');

  if (intent.dependencies && intent.dependencies.length > 0) {
    lines.push('## Dependencies');
    for (const d of intent.dependencies) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (intent.constraints.length > 0) {
    lines.push('## Constraints to Verify');
    for (const c of intent.constraints) {
      lines.push(`- [ ] ${c}`);
    }
    lines.push('');
  }

  lines.push('## Files to Investigate');
  lines.push('- (Auto-detected during implementation)');

  return lines.join('\n');
}

function buildVerifyTemplate(intent: ParsedIntent): string {
  const lines: string[] = [];

  lines.push(`# Verification: ${intent.title}`);
  lines.push('');

  lines.push('## Goal Completion');
  for (const goal of intent.goals) {
    lines.push(`- [ ] ${goal}`);
  }
  lines.push('');

  if (intent.constraints.length > 0) {
    lines.push('## Constraint Compliance');
    for (const c of intent.constraints) {
      lines.push(`- [ ] ${c}`);
    }
    lines.push('');
  }

  if (intent.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance Criteria');
    for (const a of intent.acceptanceCriteria) {
      lines.push(`- [ ] ${a}`);
    }
    lines.push('');
  }

  lines.push('## Test Results');
  lines.push('- Unit: (pending)');
  lines.push('- Integration: (pending)');
  lines.push('');

  lines.push('## Changed Files');
  lines.push('- (Auto-populated after implementation)');

  return lines.join('\n');
}

function buildPrompt(intent: ParsedIntent): string {
  const sections: string[] = [];

  sections.push(`# Intent: ${intent.title}`);
  sections.push('');
  sections.push(
    'このタスクはインテントファイルから自動生成されました。以下の宣言に従って実装してください。',
  );
  sections.push('');

  if (intent.description) {
    sections.push(`## 概要`);
    sections.push(intent.description);
    sections.push('');
  }

  sections.push('## 達成すべきゴール（必須）');
  for (let i = 0; i < intent.goals.length; i++) {
    sections.push(`${i + 1}. ${intent.goals[i]}`);
  }
  sections.push('');

  if (intent.constraints.length > 0) {
    sections.push('## 制約条件（違反不可）');
    for (const c of intent.constraints) {
      sections.push(`- ⚠️ ${c}`);
    }
    sections.push('');
  }

  if (intent.acceptanceCriteria.length > 0) {
    sections.push('## 受入基準');
    for (const a of intent.acceptanceCriteria) {
      sections.push(`- ✅ ${a}`);
    }
    sections.push('');
  }

  if (intent.hints && intent.hints.length > 0) {
    sections.push('## 実装ヒント');
    for (const h of intent.hints) {
      sections.push(`- 💡 ${h}`);
    }
    sections.push('');
  }

  sections.push('## 指示');
  sections.push(
    '上記のゴールを全て達成し、制約条件を全て守り、受入基準を満たすように実装してください。',
  );
  sections.push('実装完了後、verify.mdに結果を記録してください。');

  return sections.join('\n');
}
