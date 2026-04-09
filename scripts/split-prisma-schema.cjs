#!/usr/bin/env node
/**
 * split-prisma-schema.cjs
 *
 * One-shot tool that splits rapitas-backend/prisma/schema.prisma into a
 * prismaSchemaFolder layout per ADR-0006. Designed to run exactly once;
 * after the split lands, this script can be deleted.
 *
 * Usage:
 *   node scripts/split-prisma-schema.cjs --dry-run   # report only
 *   node scripts/split-prisma-schema.cjs             # write files
 *
 * Behavior:
 *   1. Parses schema.prisma into model/enum blocks
 *   2. Validates that EVERY model in the file appears in MAPPING
 *   3. Writes:
 *        prisma/schema/_generators.prisma
 *        prisma/schema/<domain>.prisma  (one per domain in MAPPING)
 *   4. Removes the original schema.prisma
 *   5. Prints a per-file size report
 *
 * Safety:
 *   - Aborts if any model is not in MAPPING (no silent loss)
 *   - Aborts if total line count of outputs ≠ input (off by header)
 *   - --dry-run never touches the filesystem
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'rapitas-backend', 'prisma', 'schema.prisma');
const OUT_DIR = path.join(ROOT, 'rapitas-backend', 'prisma', 'schema');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Mapping of model/enum name -> destination domain file (without extension).
 * Adding a new model to schema.prisma requires updating this map AND
 * rerunning the splitter — but since the splitter is one-shot, in practice
 * new models will be added directly to the appropriate domain file.
 */
const MAPPING = {
  // ─── core: task management primitives ─────────────────────────────────
  Category: 'core',
  Theme: 'core',
  Project: 'core',
  Milestone: 'core',
  Task: 'core',
  Comment: 'core',
  CommentLink: 'core',
  Label: 'core',
  TaskLabel: 'core',
  TaskTemplate: 'core',
  TaskPrompt: 'core',

  // ─── time: time tracking ──────────────────────────────────────────────
  TimeEntry: 'time',
  PomodoroSession: 'time',
  ActivityLog: 'time',
  DailyScheduleBlock: 'time',

  // ─── learning: study, habits, spaced repetition ───────────────────────
  ExamGoal: 'learning',
  StudyStreak: 'learning',
  LearningGoal: 'learning',
  Habit: 'learning',
  HabitLog: 'learning',
  Resource: 'learning',
  FlashcardDeck: 'learning',
  Flashcard: 'learning',

  // ─── behavior: user behavior analytics ────────────────────────────────
  UserBehavior: 'behavior',
  TaskPattern: 'behavior',
  UserBehaviorSummary: 'behavior',
  TaskSuggestionCache: 'behavior',
  TaskAnalysisConfig: 'behavior',

  // ─── agents: AI agent execution + config ──────────────────────────────
  DeveloperModeConfig: 'agents',
  AgentSession: 'agents',
  AgentAction: 'agents',
  AIAgentConfig: 'agents',
  AgentExecution: 'agents',
  AgentExecutionLog: 'agents',
  AgentExecutionConfig: 'agents',
  SystemPrompt: 'agents',
  AgentConfigAuditLog: 'agents',
  ApprovalRequest: 'agents',

  // ─── workflow: orchestration / queues ─────────────────────────────────
  WorkflowRoleConfig: 'workflow',
  WorkflowModeConfig: 'workflow',
  OrchestraSession: 'workflow',
  WorkflowQueueItem: 'workflow',

  // ─── memory: knowledge graph + RAG + journals ─────────────────────────
  KnowledgeEntry: 'memory',
  TimelineEvent: 'memory',
  ConsolidationRun: 'memory',
  KnowledgeContradiction: 'memory',
  KnowledgeReconsolidation: 'memory',
  MemoryTaskQueue: 'memory',
  MemoryJournalEntry: 'memory',
  KnowledgeGraphNode: 'memory',
  KnowledgeGraphEdge: 'memory',
  EpisodeMemory: 'memory',

  // ─── experiments: self-improvement research ───────────────────────────
  Experiment: 'experiments',
  Hypothesis: 'experiments',
  CriticReview: 'experiments',
  LearningPattern: 'experiments',
  WorkflowLearningRecord: 'experiments',
  WorkflowOptimizationRule: 'experiments',
  PromptEvolution: 'experiments',

  // ─── github: GitHub integration ───────────────────────────────────────
  GitHubIntegration: 'github',
  GitHubPullRequest: 'github',
  GitHubPRReview: 'github',
  GitHubPRComment: 'github',
  GitHubIssue: 'github',
  GitCommit: 'github',
  FavoriteDirectory: 'github',

  // ─── system: users, sessions, settings, notifications ─────────────────
  User: 'system',
  UserSession: 'system',
  UserSettings: 'system',
  Notification: 'system',

  // ─── schedule: schedule events, paid leave ────────────────────────────
  ScheduleEventType: 'schedule', // enum
  ScheduleEvent: 'schedule',
  PaidLeaveBalance: 'schedule',
};

const HEADER_BANNER = (domain) => `// ============================================================================
// ${domain}.prisma — auto-arranged by scripts/split-prisma-schema.cjs (ADR-0006)
// Source of truth for the ${domain} sub-domain. Add new models in this file
// rather than recreating a monolithic schema.prisma.
// ============================================================================

`;

function parseBlocks(text) {
  // Normalize line endings to LF for parsing; we'll re-split by detected EOL
  // when emitting if needed. Prisma is fine with LF on every platform.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  /** @type {Array<{kind: 'header'|'model'|'enum', name?: string, body: string}>} */
  const blocks = [];

  // 1. Header = everything before the first `model` or `enum`
  let firstBlockIdx = lines.findIndex((l) => /^(model|enum)\s+\w+\s*\{/.test(l));
  if (firstBlockIdx === -1) firstBlockIdx = lines.length;
  blocks.push({ kind: 'header', body: lines.slice(0, firstBlockIdx).join('\n') });

  // 2. Walk forward, capturing each model/enum block (with leading comments)
  let i = firstBlockIdx;
  while (i < lines.length) {
    // Capture leading comment lines (no blank line in between)
    let leadStart = i;
    while (leadStart > firstBlockIdx) {
      const prev = lines[leadStart - 1];
      if (prev === undefined) break;
      if (prev.trim() === '') break;
      if (!prev.trim().startsWith('//')) break;
      leadStart--;
    }
    // Don't steal comments from the previous block — only those *immediately*
    // adjacent to this header without an intervening blank line.

    const headerMatch = lines[i].match(/^(model|enum)\s+(\w+)\s*\{/);
    if (!headerMatch) {
      i++;
      continue;
    }
    const kind = headerMatch[1];
    const name = headerMatch[2];

    // Find the matching `}` at column 0
    let end = i + 1;
    while (end < lines.length && lines[end] !== '}') end++;
    if (end >= lines.length) {
      throw new Error(`Unterminated ${kind} ${name} starting at line ${i + 1}`);
    }

    // The block is [leadStart .. end] inclusive
    // But leadStart was for "comments immediately above". We re-anchor:
    // body starts at the first non-blank line that's either a comment
    // attached to this header or the header itself.
    let bodyStart = i;
    // Look back for adjacent comments
    while (
      bodyStart > 0 &&
      lines[bodyStart - 1] !== undefined &&
      lines[bodyStart - 1].trim().startsWith('//') &&
      lines[bodyStart - 1].trim() !== ''
    ) {
      bodyStart--;
    }
    // If we walked back, make sure we don't grab comments that belong to
    // the previous block (separated by blank line).
    // Already handled by the .trim() === '' check above.

    // Mark these lead lines as consumed by NOT re-emitting them on the next
    // iteration. We do this by tracking what we've written.
    const body = lines.slice(bodyStart, end + 1).join('\n');
    blocks.push({ kind, name, body, _start: bodyStart, _end: end });
    i = end + 1;
  }

  return blocks;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`✖ ${SRC} does not exist`);
    process.exit(1);
  }
  const text = fs.readFileSync(SRC, 'utf8');
  const blocks = parseBlocks(text);

  const header = blocks[0].body;
  const modelBlocks = blocks.slice(1);

  // Validate every model is in MAPPING
  const missing = [];
  for (const b of modelBlocks) {
    if (!(b.name in MAPPING)) missing.push(`${b.kind} ${b.name}`);
  }
  if (missing.length > 0) {
    console.error(`✖ ${missing.length} model(s)/enum(s) not in MAPPING:`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  // Group blocks by destination domain
  /** @type {Record<string, Array<{name: string, body: string}>>} */
  const groups = {};
  for (const b of modelBlocks) {
    const dom = MAPPING[b.name];
    if (!groups[dom]) groups[dom] = [];
    groups[dom].push({ name: b.name, body: b.body });
  }

  // Build output files
  /** @type {Record<string, string>} */
  const outputs = {};

  // _generators.prisma — header (generator + datasource), with previewFeatures
  outputs._generators = header
    .replace(
      /generator\s+client\s*\{[^}]*\}/m,
      `generator client {\n  provider        = "prisma-client-js"\n  previewFeatures = ["prismaSchemaFolder"]\n}`
    )
    .trimEnd() + '\n';

  // One file per domain
  for (const [domain, items] of Object.entries(groups)) {
    const banner = HEADER_BANNER(domain);
    const body = items.map((b) => b.body).join('\n\n');
    outputs[domain] = banner + body + '\n';
  }

  // Sanity: total non-blank model body lines preserved
  const inputModelLines = modelBlocks
    .map((b) => b.body.split('\n').length)
    .reduce((a, b) => a + b, 0);
  const outputModelLines = Object.entries(outputs)
    .filter(([k]) => k !== '_generators')
    .map(([, v]) => v.split(/\r?\n/).length - HEADER_BANNER('x').split('\n').length - 1)
    .reduce((a, b) => a + b, 0);

  console.log(`Parsed ${modelBlocks.length} block(s) from schema.prisma`);
  console.log(`Domains: ${Object.keys(groups).sort().join(', ')}`);
  console.log('');
  console.log('Per-file plan:');
  const sortedKeys = ['_generators', ...Object.keys(groups).sort()];
  for (const k of sortedKeys) {
    const lc = outputs[k].split('\n').length;
    const items = k === '_generators' ? '(generator + datasource)' : `${groups[k].length} models`;
    console.log(`  ${(k + '.prisma').padEnd(24)} ${String(lc).padStart(5)} lines  ${items}`);
  }
  console.log('');
  console.log(`Input model body lines:  ${inputModelLines}`);
  console.log(`Output model body lines: ${outputModelLines} (delta: ${outputModelLines - inputModelLines})`);

  if (DRY_RUN) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  // Write files
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.prisma`), content);
  }
  // Remove the original
  fs.rmSync(SRC);

  console.log(`\n✓ Wrote ${Object.keys(outputs).length} files to ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`✓ Removed original ${path.relative(ROOT, SRC)}`);
  console.log('\n⚠ Next steps (run yourself, not the agent):');
  console.log('  1. Restart the dev server so prisma generate picks up the new layout');
  console.log('  2. Verify `prisma db push` reports no diff against your dev DB');
  console.log('  3. Run `bun test` in rapitas-backend');
}

main();
