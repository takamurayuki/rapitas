/**
 * idea-qd-gate
 *
 * Quality-Diversity acceptance gate for idea submissions (R5). The existing
 * lexical filters (hash / bigram-Jaccard / theme saturation) pass semantic
 * monoculture straight through — plain over-generation is ~95% duplicates on
 * blind human grading (arXiv:2409.04109). This gate adds:
 *   ② an INDEPENDENT LLM judge that compares the candidate against its nearest
 *      existing neighbors — generator self-reported novelty is not trusted
 *      (AI-Scientist failure mode, arXiv:2502.14297), and
 *   ③ a QD grid cell (subsystem × task-kind × beneficiary, QDAIF-style
 *      arXiv:2310.13032): filling an EMPTY cell is accepted outright; adding to
 *      an occupied cell must BEAT the incumbents in the same judgment.
 * Fail-open: when the judge is unavailable the idea is accepted as before —
 * this gate raises diversity, it is not a safety gate. Kill switch:
 * RAPITAS_QD_IDEA_GATE=off. Not responsible for storing ideas (idea-box-service).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { DEFAULT_MODELS } from '../../utils/ai-client/types';
import { bigramJaccard } from './theme-saturation';

const log = createLogger('memory:idea-qd-gate');

/** Neighbors shown to the judge. */
const NEIGHBOR_K = 6;
/** Open ideas in an occupied cell before a challenge is required. */
const CELL_CAP = 2;
/** Max candidate pool scanned lexically for neighbors. */
const NEIGHBOR_POOL = 200;

/** Whether the QD gate is enabled (default ON; set 0/false/off to skip). */
export function isQdIdeaGateEnabled(): boolean {
  const v = (process.env.RAPITAS_QD_IDEA_GATE || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export interface QdGateResult {
  accept: boolean;
  /** Existing idea the candidate duplicates (returned to callers as the no-op id). */
  duplicateOfId?: number;
  /** Grid cell label `subsystem/kind/beneficiary` to tag the stored idea with. */
  cell?: string;
  /** Human-readable reason (logging / observability). */
  reason: string;
  /** True when a judge actually ran (false = fail-open pass-through). */
  judged: boolean;
}

/** One neighbor shown to the judge. */
export interface NeighborIdea {
  id: number;
  title: string;
  content: string;
  cell: string | null;
}

/**
 * Extract the `cell:` tag from a stored idea's tags JSON. Pure.
 *
 * @param tagsJson - KnowledgeEntry.tags (JSON array string). / tags列
 * @returns The cell label or null. / セルラベル
 */
export function parseCellTag(tagsJson: string | null | undefined): string | null {
  if (!tagsJson) return null;
  try {
    const tags = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(tags)) return null;
    const t = tags.find((x): x is string => typeof x === 'string' && x.startsWith('cell:'));
    return t ? t.slice('cell:'.length) : null;
  } catch {
    return null;
  }
}

/**
 * Rank open ideas by lexical similarity to the candidate and return the top K.
 * This is only the RETRIEVER for the semantic judge —借り物の高速フィルタ —
 * so recall matters more than precision.
 * NOTE: replace with a Japanese-specialized embedding retriever (Ruri/JMTEB)
 * when local embedding infra lands; plain multilingual MiniLM was measured
 * ineffective for Japanese dedup here.
 *
 * @param title - Candidate title. / 候補タイトル
 * @param content - Candidate body. / 候補本文
 * @param themeId - Theme scope (null = all). / テーマ
 * @returns Top-K neighbors with their cells. / 近傍K件
 */
export async function findNeighborIdeas(
  title: string,
  content: string,
  themeId: number | null,
): Promise<NeighborIdea[]> {
  const rows = await prisma.knowledgeEntry
    .findMany({
      where: {
        sourceType: 'idea_box',
        NOT: { sourceId: { startsWith: 'used_task_' } },
        ...(themeId != null ? { themeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: NEIGHBOR_POOL,
      select: { id: true, title: true, content: true, tags: true },
    })
    .catch(() => []);
  const probe = `${title} ${content.slice(0, 200)}`;
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      cell: parseCellTag(r.tags),
      score: bigramJaccard(probe, `${r.title} ${r.content.slice(0, 200)}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, NEIGHBOR_K)
    .map(({ score: _score, ...rest }) => rest);
}

/**
 * Build the single-call judge prompt: semantic novelty vs neighbors + QD cell
 * assignment. Pure and unit-testable.
 *
 * @param p - Candidate and its neighbors. / 候補と近傍
 * @returns Judge prompt. / 判定プロンプト
 */
export function buildQdJudgePrompt(p: {
  title: string;
  content: string;
  neighbors: NeighborIdea[];
}): string {
  const neighborList =
    p.neighbors.length > 0
      ? p.neighbors
          .map(
            (n) =>
              `- id=${n.id}${n.cell ? ` [cell: ${n.cell}]` : ''}: ${n.title} — ${n.content.slice(0, 160)}`,
          )
          .join('\n')
      : '(既存アイデアなし)';
  return `あなたはアイデアポートフォリオの審査員です。新しい候補アイデアが、既存の近傍アイデアと比べて**意味的に本当に新しいか**を判定してください。言い換え・粒度違い・同じ施策の別表現は「新しくない」と判定します。提案者の自己申告は信用しません。

## 候補アイデア
タイトル: ${p.title}
内容: ${p.content.slice(0, 600)}

## 既存の近傍アイデア
${neighborList}

## 判定手順
1. novelty: 候補が近傍のいずれかと意味的に同一/ほぼ同一なら "duplicate"（duplicateOfId にその id）。方向性は同じでも切り口・受益者・手段が実質的に異なるなら "new"。
2. cell: 候補を「サブシステム/タスク種/受益者」の3要素で分類する。例: "ui/改善/エンドユーザー", "verification/新機能/運用者", "memory/リファクタ/開発者"。各要素は短い日本語1語。
3. beatsIncumbents: 候補と同じ cell の近傍がある場合のみ判定 — 候補がそれらより明確に価値が高い(具体性・実現可能性・インパクト)なら true。

## 出力（厳守: JSONのみ）
{"novelty":"new"|"duplicate","duplicateOfId":number|null,"cell":"サブシステム/タスク種/受益者","beatsIncumbents":true|false}`;
}

/**
 * Parse the judge reply. Tolerant of fences/preamble; unknown shape → null
 * (caller fails open). Pure and unit-testable.
 *
 * @param text - Raw judge reply. / 応答
 * @returns Parsed verdict or null. / 解析結果
 */
export function parseQdVerdict(text: string | null | undefined): {
  novelty: 'new' | 'duplicate';
  duplicateOfId: number | null;
  cell: string | null;
  beatsIncumbents: boolean;
} | null {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      novelty?: string;
      duplicateOfId?: unknown;
      cell?: unknown;
      beatsIncumbents?: unknown;
    };
    const novelty =
      obj.novelty === 'duplicate' ? 'duplicate' : obj.novelty === 'new' ? 'new' : null;
    if (!novelty) return null;
    return {
      novelty,
      duplicateOfId: typeof obj.duplicateOfId === 'number' ? obj.duplicateOfId : null,
      cell: typeof obj.cell === 'string' && obj.cell.trim() ? obj.cell.trim().slice(0, 80) : null,
      beatsIncumbents: obj.beatsIncumbents === true,
    };
  } catch {
    return null;
  }
}

/**
 * Decide acceptance from the verdict + cell occupancy. Pure and unit-testable.
 *
 * @param verdict - Parsed judge verdict. / 判定
 * @param cellOccupancy - Open ideas already in the candidate's cell. / セル占有数
 * @param neighbors - The neighbors shown to the judge. / 近傍
 * @returns Gate decision. / 受理判断
 */
export function decideQdAcceptance(
  verdict: NonNullable<ReturnType<typeof parseQdVerdict>>,
  cellOccupancy: number,
  neighbors: NeighborIdea[],
): QdGateResult {
  if (verdict.novelty === 'duplicate') {
    const dup =
      verdict.duplicateOfId != null && neighbors.some((n) => n.id === verdict.duplicateOfId)
        ? verdict.duplicateOfId
        : neighbors[0]?.id;
    return {
      accept: false,
      duplicateOfId: dup,
      reason: '意味的重複（QDジャッジ）',
      judged: true,
    };
  }
  // Empty cell → accept outright (fills the map). Occupied cell → must beat.
  if (cellOccupancy >= CELL_CAP && !verdict.beatsIncumbents) {
    return {
      accept: false,
      duplicateOfId: neighbors.find((n) => n.cell === verdict.cell)?.id ?? neighbors[0]?.id,
      cell: verdict.cell ?? undefined,
      reason: `セル占有済み（${cellOccupancy}件）かつ既存案に勝てず`,
      judged: true,
    };
  }
  return {
    accept: true,
    cell: verdict.cell ?? undefined,
    reason: cellOccupancy > 0 ? 'セル既存案に勝ち抜き' : '新規セルを充填',
    judged: true,
  };
}

/**
 * Run the full QD gate for a candidate idea. Fail-open on any judge failure.
 *
 * @param p - Candidate title/content/theme. / 候補
 * @returns Gate result (accept:true + judged:false when failed open). / 判定結果
 */
export async function evaluateIdeaQd(p: {
  title: string;
  content: string;
  themeId: number | null;
}): Promise<QdGateResult> {
  const passThrough: QdGateResult = { accept: true, reason: 'ゲート未実行', judged: false };
  if (!isQdIdeaGateEnabled()) return passThrough;

  try {
    const neighbors = await findNeighborIdeas(p.title, p.content, p.themeId);
    // Nothing to compare against — accept (first ideas fill the map for free).
    if (neighbors.length === 0) return { accept: true, reason: '近傍なし', judged: false };

    const res = await sendAIMessage({
      provider: 'claude',
      model: DEFAULT_MODELS.claude,
      systemPrompt: 'You are a strict idea-portfolio curator.',
      maxTokens: 400,
      messages: [
        {
          role: 'user',
          content: buildQdJudgePrompt({ title: p.title, content: p.content, neighbors }),
        },
      ],
    });
    const verdict = parseQdVerdict(res.content);
    if (!verdict) return passThrough;

    const cellOccupancy = verdict.cell
      ? await prisma.knowledgeEntry
          .count({
            where: {
              sourceType: 'idea_box',
              NOT: { sourceId: { startsWith: 'used_task_' } },
              tags: { contains: `cell:${verdict.cell}` },
              ...(p.themeId != null ? { themeId: p.themeId } : {}),
            },
          })
          .catch(() => 0)
      : 0;

    const decision = decideQdAcceptance(verdict, cellOccupancy, neighbors);
    log.info(
      {
        title: p.title.slice(0, 60),
        accept: decision.accept,
        cell: decision.cell,
        cellOccupancy,
        reason: decision.reason,
      },
      '[qd-gate] Idea judged',
    );
    return decision;
  } catch (err) {
    log.warn(
      { err, title: p.title.slice(0, 60) },
      '[qd-gate] Judge failed — accepting (fail-open)',
    );
    return passThrough;
  }
}
