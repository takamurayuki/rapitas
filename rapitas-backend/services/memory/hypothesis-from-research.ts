/**
 * hypothesis-from-research
 *
 * Reliable hypothesis CREATION: parse a structured `## 仮説` / `## Hypotheses`
 * section out of a saved research.md and file each line into the ledger. Agents
 * always produce research.md (a required artifact), so a parseable section is a
 * far more reliable creation trigger than asking the agent to remember a
 * `POST /hypotheses` call — which it rarely does, leaving the ledger empty.
 * Not responsible for evidence recording or validation (see hypothesis-service).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { submitHypothesis, normalizeDomain, type HypothesisDomain } from './hypothesis-service';

const log = createLogger('memory:hypothesis-from-research');

/** Most hypotheses to file from a single research.md, to avoid ledger noise. */
const MAX_PER_RESEARCH = 6;
/** Mirror checkFalsifiable's minimum statement length so we skip stubs early. */
const MIN_STATEMENT_LEN = 12;

/**
 * Extract `- [domain] statement` bullets under a `## 仮説` / `## Hypotheses`
 * heading. The `[domain]` prefix is optional (defaults via normalizeDomain).
 *
 * @param content - research.md body / research.md 本文
 * @returns Parsed conjectures (statement + domain) / 抽出した仮説
 */
export function extractResearchHypotheses(
  content: string | null | undefined,
): { statement: string; domain: HypothesisDomain }[] {
  if (!content) return [];
  const out: { statement: string; domain: HypothesisDomain }[] = [];
  let inSection = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // Heading whose text starts with 仮説 / hypothes opens the section.
    if (/^#{1,6}\s*(仮説|hypothes)/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line)) break; // next heading closes it
    if (!inSection) continue;
    const m = line.match(/^[-*]\s*(?:\[([^\]]+)\]\s*)?(.+)$/);
    if (!m) continue;
    const statement = (m[2] ?? '').trim();
    if (
      statement.length < MIN_STATEMENT_LEN ||
      statement.includes('?') ||
      statement.includes('？')
    ) {
      continue;
    }
    out.push({ statement, domain: normalizeDomain(m[1]) });
    if (out.length >= MAX_PER_RESEARCH) break;
  }
  return out;
}

/**
 * File every conjecture parsed from a research.md into the hypothesis ledger.
 * Best-effort: never throws (a parse/DB hiccup must not fail the research save).
 * submitHypothesis applies the falsifiability gate and dedupes by statement, so
 * re-saving research.md does not create duplicates.
 *
 * @param taskId - Task whose research produced these / 研究元タスク
 * @param content - research.md body / research.md 本文
 * @returns Count of newly-filed hypotheses / 新規起票数
 */
export async function fileHypothesesFromResearch(
  taskId: number,
  content: string | null | undefined,
): Promise<number> {
  const items = extractResearchHypotheses(content);
  if (items.length === 0) return 0;
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { themeId: true } })
    .catch(() => null);
  const themeId = task?.themeId ?? undefined;

  let filed = 0;
  for (const it of items) {
    try {
      const res = await submitHypothesis({
        statement: it.statement,
        rationale: `タスク#${taskId} の research.md で起票`,
        domain: it.domain,
        ...(themeId != null && { themeId }),
        originTaskId: taskId,
        source: 'research',
      });
      if (res.ok) filed += 1;
    } catch (err) {
      log.warn({ err, taskId }, '[hypothesis-from-research] submit failed');
    }
  }
  if (filed > 0) log.info({ taskId, filed }, '[hypothesis-from-research] filed hypotheses');
  return filed;
}
