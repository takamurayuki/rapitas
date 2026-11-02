/**
 * InsightTools
 *
 * The P1/P2 MCP tools of #1318: read and record hypotheses, read the quality
 * metrics, decision calibration, knowledge-graph neighbours and the stored PR
 * risk score. Not responsible for computing any of those — each reads the
 * service that already does.
 *
 * NOTE: Learning patterns are deliberately NOT exposed: #1322 found all 856
 * rows self-referential ("apply what worked on task X"), carrying no method.
 */
import { HYPOTHESIS_DOMAINS, type HypothesisStatus } from '../memory/hypothesis-types';
import type { MCPTool, MCPToolResult } from './mcp-types';

/** Marks rows that arrived over MCP, so externally filed ones are countable. */
const MCP_SOURCE = 'mcp';
const STATUSES = ['open', 'supported', 'refuted', 'inconclusive', 'all'] as const;
const MAX_LIST = 50;
const MAX_WINDOWS = 12;

/** Service calls this module makes — injectable for tests. */
export interface InsightDeps {
  listHypotheses: (o: {
    status?: HypothesisStatus | 'all';
    domain?: (typeof HYPOTHESIS_DOMAINS)[number];
    stages?: 'all';
    limit?: number;
  }) => Promise<{ hypotheses: unknown[]; total: number }>;
  submitHypothesis: (i: {
    statement: string;
    rationale: string;
    domain?: (typeof HYPOTHESIS_DOMAINS)[number];
    source?: string;
  }) => Promise<{ ok: boolean; id?: number; reason?: string }>;
  growthLedger: () => Promise<{ windowDays: number; windows: unknown[] }>;
  decisionStats: () => Promise<unknown>;
  findRelated: (nodeId: number) => Promise<{ nodes: unknown[]; edges: unknown[] }>;
  latestPrRisk: (repo: string, prNumber: number) => Promise<unknown | null>;
}

/** The real services, loaded on first use so listing tools touches no DB. */
function defaultDeps(): InsightDeps {
  return {
    listHypotheses: async (o) => (await import('../memory/hypothesis-queries')).listHypotheses(o),
    submitHypothesis: async (i) =>
      (await import('../memory/hypothesis-service')).submitHypothesis(i),
    growthLedger: async () =>
      (await import('../self-improvement/growth-ledger-metrics')).computeGrowthLedgerMetrics(),
    decisionStats: async () =>
      (await import('../memory/decision-journal')).getDecisionCalibrationStats(),
    findRelated: async (id) => (await import('../self-learning/knowledge-graph')).findRelated(id),
    latestPrRisk: async (repo, prNumber) => {
      const { prisma } = await import('../../config/database');
      return prisma.prRiskScore.findFirst({
        where: { repo, prNumber },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}

type Prop = MCPTool['inputSchema']['properties'][string];
const obj = (properties: Record<string, Prop>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
});

/** The tools this module owns. */
export const INSIGHT_TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: 'rapitas_list_hypotheses',
    description:
      'List hypotheses from the Rapitas ledger — what the system believes and on what evidence. ' +
      'Use status "supported" for settled findings before acting on an assumption.',
    inputSchema: obj({
      status: { type: 'string', enum: [...STATUSES], description: 'Default "open"' },
      domain: { type: 'string', enum: [...HYPOTHESIS_DOMAINS], description: 'Filter by domain' },
      limit: { type: 'string', description: `Max rows (1-${MAX_LIST}, default 20)` },
    }),
  },
  {
    name: 'rapitas_record_hypothesis',
    description:
      'Record a falsifiable hypothesis in the ledger. Search with rapitas_list_hypotheses first; ' +
      'a vague statement is rejected with the reason.',
    inputSchema: obj(
      {
        statement: { type: 'string', description: 'A claim that evidence could prove wrong' },
        rationale: { type: 'string', description: 'Why it is believed' },
        domain: {
          type: 'string',
          enum: [...HYPOTHESIS_DOMAINS],
          description: 'What the claim is about (default codebase)',
        },
      },
      ['statement', 'rationale'],
    ),
  },
  {
    name: 'rapitas_get_quality_metrics',
    description:
      'Weekly quality metrics, newest first: autonomy, critic first-pass rate, repair effort, ' +
      'defect recurrence and knowledge-base validation.',
    inputSchema: obj({
      windows: { type: 'string', description: `Weeks to return (1-${MAX_WINDOWS}, default 4)` },
    }),
  },
  {
    name: 'rapitas_get_decision_calibration',
    description:
      'How often recorded plan decisions turned out right, by who decided, plus recent reviews.',
    inputSchema: obj({}),
  },
  {
    name: 'rapitas_find_related_knowledge',
    description: 'Neighbours of a knowledge-graph node: the nodes linked to it and the links.',
    inputSchema: obj({ nodeId: { type: 'string', description: 'Graph node id' } }, ['nodeId']),
  },
  {
    name: 'rapitas_get_pr_risk',
    description: 'The latest stored risk score for a pull request, if one was computed.',
    inputSchema: obj(
      {
        repo: { type: 'string', description: 'owner/name' },
        prNumber: { type: 'string', description: 'Pull request number' },
      },
      ['repo', 'prNumber'],
    ),
  },
];

const ok = (text: string): MCPToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): MCPToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});
const json = (value: unknown): MCPToolResult => ok(JSON.stringify(value, null, 2));

/**
 * A positive integer from a string argument, or undefined when absent.
 *
 * NOTE: Matched as digits, not parseInt — parseInt reads "5abc" as 5.
 */
function positiveInt(raw: string | undefined): number | undefined | 'invalid' {
  if (raw === undefined || raw.trim() === '') return undefined;
  return /^[1-9]\d{0,8}$/.test(raw.trim()) ? Number(raw.trim()) : 'invalid';
}

async function listHypothesesTool(a: Record<string, string>, d: InsightDeps) {
  const status = (a.status ?? 'open') as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) return fail(`status must be one of: ${STATUSES.join(', ')}`);
  const domain = a.domain as (typeof HYPOTHESIS_DOMAINS)[number] | undefined;
  if (domain && !HYPOTHESIS_DOMAINS.includes(domain)) {
    return fail(`domain must be one of: ${HYPOTHESIS_DOMAINS.join(', ')}`);
  }
  const limit = positiveInt(a.limit);
  if (limit === 'invalid') return fail('limit must be a positive integer.');
  // Settled findings outlive the active forgetting stage; reading only active
  // rows reported 44 of 2,100 hypotheses and 0 of 1,509 supported (#1321).
  const settled = status === 'supported' || status === 'refuted' || status === 'all';
  return json(
    await d.listHypotheses({
      status,
      ...(domain ? { domain } : {}),
      ...(settled ? { stages: 'all' as const } : {}),
      limit: Math.min(limit ?? 20, MAX_LIST),
    }),
  );
}

async function recordHypothesisTool(a: Record<string, string>, d: InsightDeps) {
  const statement = (a.statement ?? '').trim();
  const rationale = (a.rationale ?? '').trim();
  if (!statement || !rationale) return fail('statement and rationale are both required.');
  const domain = a.domain as (typeof HYPOTHESIS_DOMAINS)[number] | undefined;
  const r = await d.submitHypothesis({
    statement,
    rationale,
    ...(domain && HYPOTHESIS_DOMAINS.includes(domain) ? { domain } : {}),
    source: MCP_SOURCE,
  });
  return r.ok
    ? ok(`Recorded hypothesis #${r.id}: ${statement}`)
    : fail(`Not recorded: ${r.reason}`);
}

async function qualityMetricsTool(a: Record<string, string>, d: InsightDeps) {
  const n = positiveInt(a.windows);
  if (n === 'invalid') return fail('windows must be a positive integer.');
  const ledger = await d.growthLedger();
  return json({ ...ledger, windows: ledger.windows.slice(0, Math.min(n ?? 4, MAX_WINDOWS)) });
}

async function relatedKnowledgeTool(a: Record<string, string>, d: InsightDeps) {
  const id = positiveInt(a.nodeId);
  if (id === undefined || id === 'invalid') return fail('nodeId must be a positive integer.');
  return json(await d.findRelated(id));
}

async function prRiskTool(a: Record<string, string>, d: InsightDeps) {
  const repo = (a.repo ?? '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail('repo must be "owner/name".');
  const pr = positiveInt(a.prNumber);
  if (pr === undefined || pr === 'invalid') return fail('prNumber must be a positive integer.');
  const row = await d.latestPrRisk(repo, pr);
  return row ? json(row) : ok(`No risk score is stored for ${repo}#${pr}.`);
}

/**
 * Run one insight tool.
 *
 * @param toolName - The tool to run / 実行するツール名
 * @param args - Tool arguments / ツール引数
 * @param deps - Services to call (injectable for tests) / 呼び出すサービス
 * @returns The result, or null when this module owns no such tool / 結果、未知のツールなら null
 */
export async function executeInsightTool(
  toolName: string,
  args: Record<string, string>,
  deps: InsightDeps = defaultDeps(),
): Promise<MCPToolResult | null> {
  switch (toolName) {
    case 'rapitas_list_hypotheses':
      return listHypothesesTool(args, deps);
    case 'rapitas_record_hypothesis':
      return recordHypothesisTool(args, deps);
    case 'rapitas_get_quality_metrics':
      return qualityMetricsTool(args, deps);
    case 'rapitas_get_decision_calibration':
      return json(await deps.decisionStats());
    case 'rapitas_find_related_knowledge':
      return relatedKnowledgeTool(args, deps);
    case 'rapitas_get_pr_risk':
      return prRiskTool(args, deps);
    default:
      return null;
  }
}
