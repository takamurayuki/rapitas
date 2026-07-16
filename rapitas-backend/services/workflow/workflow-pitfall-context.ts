/**
 * WorkflowPitfallContext
 *
 * Builds the implementer's "known pitfalls" prompt section from the knowledge
 * graph: which verification-gate rejections this task's TYPE and TECHNOLOGIES
 * have historically run into (concept/technology —causes→ problem edges written
 * by task-learning-recorder). This is the graph's first behavioral consumer —
 * before this, every task outcome wrote nodes that only a dashboard ever read.
 * Best-effort: any failure yields '' so context building never breaks.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { taskTypeLabel, extractTechLabels } from '../self-learning/task-learning-recorder';

const log = createLogger('workflow:pitfall-context');

/** Max pitfall lines injected — the warning must stay a nudge, not a wall. */
const MAX_PITFALLS = 4;

/** Minimum accumulated edge weight before a pitfall is worth warning about. */
const MIN_EDGE_WEIGHT = 0.3;

/**
 * One-line, cause-specific advice. Keyed by the stable WorkflowTransition
 * cause codes the recorder writes as problem-node labels.
 */
const CAUSE_ADVICE: Record<string, string> = {
  verify_repair: '提出前に lint / typecheck / 関連テストを自分で実行して確認すること',
  adversarial_review_failed:
    'planの範囲外の変更や表面的な修正を避け、diffが要求を満たすか自己点検すること',
  ci_repair: 'ローカルとCIの環境差(依存・env・OS差)を考慮してから提出すること',
  verify_validation_failed: 'verify.mdの必須セクションと実測結果の記載形式を守ること',
  verify_no_changes: '実装が必要なタスクでコード変更ゼロのまま完了報告しないこと',
  log_polluted_rejected: '成果物mdにログや会話的前置きを混入させないこと',
  plan_invalid: 'planのチェックリスト形式・必須セクションを守ること',
};

/**
 * Build the known-pitfalls section for a task, or '' when the graph holds no
 * sufficiently-weighted problems for its type/technologies.
 *
 * @param task - Title (for type/tech extraction). / タイトル
 * @param language - Prompt language. / プロンプト言語
 * @returns Markdown section or empty string. / セクション文字列
 */
export async function buildKnownPitfallsSection(
  task: { title: string },
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const labels: Array<{ label: string; nodeType: string }> = [
      { label: taskTypeLabel(task.title), nodeType: 'concept' },
      ...extractTechLabels(task.title).map((tech) => ({ label: tech, nodeType: 'technology' })),
    ];

    const sourceNodes = await prisma.knowledgeGraphNode.findMany({
      where: { OR: labels.map((l) => ({ label: l.label, nodeType: l.nodeType })) },
      select: { id: true, label: true },
    });
    if (sourceNodes.length === 0) return '';

    const edges = await prisma.knowledgeGraphEdge.findMany({
      where: {
        edgeType: 'causes',
        fromNodeId: { in: sourceNodes.map((n) => n.id) },
        weight: { gte: MIN_EDGE_WEIGHT },
      },
      include: { toNode: { select: { id: true, label: true } } },
      orderBy: { weight: 'desc' },
    });
    if (edges.length === 0) return '';

    // Aggregate per problem across sources (a problem linked from both the
    // task type AND a technology outranks a single-source one).
    const byProblem = new Map<number, { label: string; weight: number; sources: Set<string> }>();
    const sourceById = new Map(sourceNodes.map((n) => [n.id, n.label]));
    for (const e of edges) {
      const agg = byProblem.get(e.toNode.id) ?? {
        label: e.toNode.label,
        weight: 0,
        sources: new Set<string>(),
      };
      agg.weight += e.weight;
      const src = sourceById.get(e.fromNodeId);
      if (src) agg.sources.add(src);
      byProblem.set(e.toNode.id, agg);
    }

    const top = [...byProblem.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_PITFALLS);
    if (top.length === 0) return '';

    const header =
      language === 'en'
        ? '## ⚠️ Known pitfalls for this kind of task (from the knowledge graph)'
        : '## ⚠️ この種のタスクの既知の失敗パターン(知識グラフより)';
    const lines = top.map((p) => {
      const advice = CAUSE_ADVICE[p.label];
      const sources = [...p.sources].join(' / ');
      return advice
        ? `- **${p.label}**(関連: ${sources})— ${advice}`
        : `- **${p.label}**(関連: ${sources})`;
    });
    const footer =
      language === 'en'
        ? 'These gate rejections have actually happened on similar tasks — avoid repeating them.'
        : '上記は類似タスクで実際に発生した検証ゲート却下です。同じ轍を踏まないこと。';

    // Observability: which warnings fired lets the effect be verified later —
    // "did tasks that received a verify_repair warning bounce less often?"
    log.info(
      { pitfalls: top.map((p) => ({ label: p.label, weight: +p.weight.toFixed(2) })) },
      '[pitfall-context] Known-pitfalls warning injected into implementer context',
    );
    return `${header}\n\n${lines.join('\n')}\n\n${footer}`;
  } catch (err) {
    log.debug({ err }, '[pitfall-context] Failed to build known-pitfalls section');
    return '';
  }
}
