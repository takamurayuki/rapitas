/**
 * postmortem-validator
 *
 * Checks the estimator against version-controlled known failure chains
 * (golden replay) and counts live edges / DecisionLog rows that touch them.
 * Reports numbers only; it never changes the lineage itself.
 */
import type {
  ChainValidation,
  LineageEdge,
  LineageNode,
  LineageValidation,
} from './failure-lineage-types';
import { buildEdges, buildNodes } from './lineage-builder';
import { KNOWN_CHAINS, type KnownChain } from './known-chains.fixture';

const REPLAY_BASE_MS = Date.UTC(2026, 0, 1);

/** Replays one chain through the live pipeline and counts reproduced edges. */
function replayChain(
  chain: KnownChain,
  executionId: number,
): ChainValidation & { pairs: string[] } {
  const rows = chain.events.map((e, i) => ({
    id: i + 1,
    executionId,
    logChunk: e.text,
    logType: 'stdout',
    sequenceNumber: i,
    timestamp: REPLAY_BASE_MS + e.offsetSec * 1000,
  }));
  const nodes = buildNodes(rows);
  const edges = buildEdges(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let expected = 0;
  let matched = 0;
  const pairs: string[] = [];
  chain.events.forEach((e, i) => {
    if (e.parent === null) return;
    expected++;
    const childId = `log-${i + 1}`;
    const parentId = `log-${e.parent + 1}`;
    const est = edges.find((x) => x.childId === childId);
    const p = byId.get(parentId);
    const c = byId.get(childId);
    if (p && c) pairs.push(`${p.templateId}>${c.templateId}`);
    if (est && est.parentId === parentId) matched++;
  });
  return {
    chainId: chain.id,
    label: chain.label,
    expectedEdges: expected,
    matchedEdges: matched,
    pairs,
  };
}

/**
 * Validates the estimator.
 *
 * @param liveNodes - Nodes of the current lineage / 現在のノード
 * @param liveEdges - Edges of the current lineage / 現在のエッジ
 * @param decisionTexts - DecisionLog text bodies / 意思決定ログ本文
 * @param chains - Known chains (defaults to the fixture) / 既知連鎖
 * @returns Validation summary; matchRate is null when there is no known edge / 照合結果
 */
export function validateLineage(
  liveNodes: readonly LineageNode[],
  liveEdges: readonly LineageEdge[],
  decisionTexts: readonly string[],
  chains: readonly KnownChain[] = KNOWN_CHAINS,
): LineageValidation {
  const replays = chains.map((c, i) => replayChain(c, i + 1));
  const knownEdgeCount = replays.reduce((s, r) => s + r.expectedEdges, 0);
  const matched = replays.reduce((s, r) => s + r.matchedEdges, 0);
  const knownPairs = new Set(replays.flatMap((r) => r.pairs));

  const byId = new Map(liveNodes.map((n) => [n.id, n]));
  let liveConfirmed = 0;
  for (const e of liveEdges) {
    const p = byId.get(e.parentId);
    const c = byId.get(e.childId);
    if (p && c && knownPairs.has(`${p.templateId}>${c.templateId}`)) liveConfirmed++;
  }

  const keywords = chains.flatMap((c) => c.keywords.map((k) => k.toLowerCase()));
  const decisionLogMatches = decisionTexts.filter((t) => {
    const lower = t.toLowerCase();
    return keywords.some((k) => lower.includes(k));
  }).length;

  return {
    matchRate: knownEdgeCount === 0 ? null : matched / knownEdgeCount,
    knownEdgeCount,
    matched,
    mismatched: knownEdgeCount - matched,
    unchecked: liveEdges.length - liveConfirmed,
    liveConfirmed,
    decisionLogMatches,
    chains: replays.map((r) => ({
      chainId: r.chainId,
      label: r.label,
      expectedEdges: r.expectedEdges,
      matchedEdges: r.matchedEdges,
    })),
  };
}
