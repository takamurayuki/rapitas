/**
 * playbook-generate
 *
 * Completion-time hook that distils a playbook from a same-shape task cluster:
 * detect cluster → ONE aux-AI call → parse → semantic/lexical dedup →
 * KnowledgeEntry(sourceType='playbook') creation. Entirely fail-open: every
 * failure degrades to a warn log (plus a timeline event on parse failure) and
 * never rethrows into the completion path.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { sendAIMessage } from '../../../utils/ai-client';
import { createContentHash } from '../utils';
import { appendEvent } from '../timeline';
import { findSemanticDuplicate, findLexicalDuplicate } from '../dedup';
import { boostDecayOnAccess } from '../forgetting';
import { detectPlaybookCluster, extractChangedFiles, RECENT_WINDOW } from './playbook-detect';
import {
  PLAYBOOK_SYSTEM_PROMPT,
  buildPlaybookPrompt,
  parsePlaybookResult,
} from './playbook-prompt';
import type { PlaybookCandidate } from './playbook-types';

const log = createLogger('memory:playbook');

/** A procedure doc is short — 3000 tokens is ample for title + 4 sections. */
const PLAYBOOK_MAX_TOKENS = 3000;
/** Slightly above success-extraction (0.7), below failure_lesson (0.75). */
const PLAYBOOK_CONFIDENCE = 0.72;

/**
 * Load a task's changed files: verify.md's 変更ファイル table first, plan.md's
 * file tables as fallback (research-only completions have no verify table).
 * [] when neither yields paths — the task is then excluded, never an error.
 */
async function loadTaskChangedFiles(taskId: number): Promise<string[]> {
  const { readWorkflowFile } = await import('../../workflow/workflow-file-utils');
  const verify = await readWorkflowFile(taskId, 'verify').catch(() => null);
  const fromVerify = extractChangedFiles(verify ?? '');
  if (fromVerify.length > 0) return fromVerify;
  const plan = await readWorkflowFile(taskId, 'plan').catch(() => null);
  return extractChangedFiles(plan ?? '');
}

/** Load a short artifact excerpt (verify preferred) for the generation prompt. */
async function loadArtifactExcerpt(taskId: number): Promise<string> {
  const { readWorkflowFile } = await import('../../workflow/workflow-file-utils');
  const verify = await readWorkflowFile(taskId, 'verify').catch(() => null);
  if (verify?.trim()) return verify;
  const plan = await readWorkflowFile(taskId, 'plan').catch(() => null);
  return plan ?? '';
}

/**
 * Generate a playbook when the just-completed task forms a same-shape cluster
 * (2+ tasks) with recent completed tasks. Fire-and-forget semantics: never
 * throws; the aux AI is called at most ONCE per completion, no retry (the next
 * same-shape completion is the retry). Duplicate playbooks reinforce the
 * existing entry instead of inserting (write-time semantic dedup).
 *
 * @param taskId - The just-completed task. / 完了直後のタスク
 */
export async function maybeGeneratePlaybook(taskId: number): Promise<void> {
  try {
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { title: true, themeId: true } })
      .catch(() => null);
    if (!task) return;

    const currentFiles = await loadTaskChangedFiles(taskId);
    if (currentFiles.length === 0) return;
    const current: PlaybookCandidate = { taskId, title: task.title, files: currentFiles };

    const rows = await prisma.task.findMany({
      where: {
        id: { not: taskId },
        parentId: null,
        status: { in: ['done', 'completed'] },
        // Same-theme preference: repetitive shapes live inside one project.
        ...(task.themeId != null ? { themeId: task.themeId } : {}),
      },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: RECENT_WINDOW,
      select: { id: true, title: true },
    });

    const candidates: PlaybookCandidate[] = [];
    for (const row of rows) {
      const files = await loadTaskChangedFiles(row.id);
      if (files.length === 0) continue;
      candidates.push({ taskId: row.id, title: row.title, files });
    }

    const cluster = detectPlaybookCluster(current, candidates);
    if (!cluster) return;

    for (const member of cluster.members) {
      member.artifactExcerpt = await loadArtifactExcerpt(member.taskId).catch(() => '');
    }

    // ONE aux-AI call per completion, no retry (retro-review's discipline).
    const response = await sendAIMessage({
      provider: 'claude',
      systemPrompt: PLAYBOOK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPlaybookPrompt(cluster) }],
      maxTokens: PLAYBOOK_MAX_TOKENS,
    });

    const parsed = parsePlaybookResult(response.content);
    if (parsed.parseFailed) {
      log.warn({ taskId }, '[playbook] AI result parse failed — fail-open (nothing stored)');
      await appendEvent({
        eventType: 'playbook_generation_failed',
        actorType: 'system',
        payload: { taskId, reason: 'parse_failed' },
        correlationId: `task_${taskId}`,
      }).catch(() => {});
      return;
    }

    // Write-time dedup: a same-shape cluster recurring later must reinforce
    // the existing playbook, not spawn a paraphrase.
    const dupId =
      (await findSemanticDuplicate(parsed.content)) ??
      (await findLexicalDuplicate(parsed.title, parsed.content));
    if (dupId != null) {
      await boostDecayOnAccess(dupId, 0.1).catch(() => {});
      log.info({ taskId, dupId }, '[playbook] Duplicate playbook — reinforced existing entry');
      return;
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        sourceType: 'playbook',
        sourceId: `task_${taskId}`,
        title: parsed.title,
        content: parsed.content,
        contentHash: createContentHash(parsed.content),
        category: 'procedure',
        tags: JSON.stringify(['playbook', 'auto_generated']),
        confidence: PLAYBOOK_CONFIDENCE,
        themeId: task.themeId,
        taskId,
        validationStatus: 'pending',
      },
    });

    const { memoryTaskQueue } = await import('../index');
    await memoryTaskQueue
      .enqueue('embed', { entryId: entry.id, content: parsed.content }, 10)
      .catch(() => {});
    await memoryTaskQueue.enqueue('validate', { entryId: entry.id }, 5).catch(() => {});

    await appendEvent({
      eventType: 'playbook_generated',
      actorType: 'system',
      payload: { taskId, entryId: entry.id, clusterSize: cluster.members.length },
      correlationId: `task_${taskId}`,
    }).catch(() => {});
    log.info(
      { taskId, entryId: entry.id, clusterSize: cluster.members.length },
      '[playbook] Playbook generated from same-shape cluster',
    );
  } catch (err) {
    log.warn({ err, taskId }, '[playbook] Generation failed — fail-open (nothing stored)');
  }
}
