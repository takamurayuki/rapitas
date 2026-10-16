/**
 * playbook-inject
 *
 * Builds the playbook prompt section for researcher/planner context: rank
 * stored playbooks by title similarity, verify freshness (do the target files
 * still exist under the task's theme workingDirectory?), and render at most
 * ONE playbook. A stale playbook (majority of target files gone) is decayed
 * via penalizeOnFailure instead of injected. Read-only otherwise; every
 * failure degrades to ''.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { penalizeOnFailure } from '../forgetting';
import { extractPlaybookTargetFiles, rankPlaybooks, MAX_PLAYBOOKS } from './playbook-detect';

const log = createLogger('memory:playbook-inject');

/** Stored playbooks scanned per injection (recent first). */
const CANDIDATE_POOL = 30;
/** Rendered content budget (chars) — bound prompt growth. */
const CONTENT_EXCERPT = 2500;

/** A playbook selected for rendering. */
export interface RankedPlaybook {
  id: number;
  title: string;
  content: string;
  similarity: number;
}

/**
 * Render one playbook as a prompt section. Pure and unit-testable.
 *
 * @param playbook - Selected playbook (null/undefined → ''). / 選択済み手順書
 * @param language - Output language. / 出力言語
 * @returns Markdown section, '' when empty. / 節(無ければ空)
 */
export function renderPlaybookSection(
  playbook: RankedPlaybook | null | undefined,
  language: 'ja' | 'en',
): string {
  if (!playbook) return '';
  const lead =
    language === 'ja'
      ? '# プレイブック(同型タスクの手順書)\n\n過去の同型タスク群から蒸留した手順書です。対象ファイル・手順・ハマりどころの土台として使ってください。ただし**コピペせず**、本タスクの要件・現在のコードに適応させること。要件が異なる箇所は手順書より本タスクを優先します。'
      : '# Playbook (procedure distilled from same-shaped tasks)\n\nA procedure distilled from previously completed same-shaped tasks. Use it as the base for target files, steps, and pitfalls — but ADAPT it to this task and the current code; where requirements differ, this task wins.';
  const head =
    language === 'ja'
      ? `## ${playbook.title}（類似度 ${Math.round(playbook.similarity * 100)}%）`
      : `## ${playbook.title} (similarity ${Math.round(playbook.similarity * 100)}%)`;
  return `${lead}\n\n${head}\n\n${playbook.content.slice(0, CONTENT_EXCERPT)}`;
}

/**
 * Build the playbook section for a researcher/planner prompt: at most ONE
 * playbook, selected by title/description similarity and gated on freshness.
 * Freshness: target files listed in the playbook's `## 対象ファイル` section
 * are resolved against the task theme's workingDirectory; when a MAJORITY is
 * missing the playbook is stale → penalizeOnFailure (decay toward the
 * forgetting pipeline) and nothing is injected. A single missing file does NOT
 * decay (renames happen). Best-effort — '' on any failure.
 *
 * @param taskId - Current task. / 現タスク
 * @param task - Title/description similarity probes. / 照合入力
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or ''. / 節(無ければ空)
 */
export async function buildPlaybookContext(
  taskId: number,
  task: { title: string; description: string | null },
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const entries = await prisma.knowledgeEntry.findMany({
      where: { sourceType: 'playbook', forgettingStage: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_POOL,
      select: { id: true, title: true, content: true },
    });
    if (entries.length === 0) return '';

    const ranked = rankPlaybooks([task.title, task.description ?? ''], entries);
    const best = ranked.slice(0, MAX_PLAYBOOKS)[0];
    if (!best) return '';

    const row = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: { theme: { select: { workingDirectory: true } } },
      })
      .catch(() => null);
    const workDir = row?.theme?.workingDirectory ?? null;
    // No workingDirectory → freshness unverifiable → do not inject (and do not
    // penalize: the playbook itself is not proven broken).
    if (!workDir) return '';

    const targets = extractPlaybookTargetFiles(best.content);
    if (targets.length > 0) {
      const missing = targets.filter((f) => !existsSync(resolve(workDir, f)));
      if (missing.length * 2 > targets.length) {
        await penalizeOnFailure(best.id).catch(() => {});
        log.info(
          { taskId, entryId: best.id, missing: missing.length, total: targets.length },
          '[playbook-inject] Stale playbook (majority of target files gone) — decayed, not injected',
        );
        return '';
      }
    }

    const section = renderPlaybookSection(best, language);
    if (section) {
      log.info(
        { taskId, entryId: best.id, similarity: best.similarity },
        '[playbook-inject] Injecting playbook',
      );
    }
    return section;
  } catch (err) {
    log.warn({ err, taskId }, '[playbook-inject] Failed to build playbook context — skipping');
    return '';
  }
}
