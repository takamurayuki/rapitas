/**
 * KnowledgeTools
 *
 * Exposes the knowledge base to MCP clients, so a session working in another
 * repository can ask whether a problem has already been solved here.
 * Not responsible for search itself — that is searchKnowledgeHybrid.
 */
import { searchKnowledgeHybrid } from '../memory/recall/hybrid-search';
import type { KnowledgeCategory } from '../memory/types';
import type { MCPTool, MCPToolResult } from './mcp-types';

/** Hits returned when the caller names no limit. */
const DEFAULT_LIMIT = 5;

/**
 * Upper bound on hits. A tool result is pasted into a model's context, so an
 * unbounded limit over 13,760 entries would spend the caller's whole window.
 */
const MAX_LIMIT = 20;

/** Characters of each entry's body included in the result. */
const EXCERPT_CHARS = 400;

/** The knowledge tools this module owns. */
export const KNOWLEDGE_TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: 'rapitas_search_knowledge',
    description:
      "Search Rapitas's knowledge base (hybrid vector + lexical). Use this BEFORE " +
      'solving a problem to find out whether it has been solved here already, and ' +
      'before filing a concern to avoid duplicating one.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'What to look for; a natural-language phrase' },
        limit: {
          type: 'string',
          description: `Max hits (default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT})`,
        },
        category: { type: 'string', description: 'Restrict to one knowledge category' },
        themeId: { type: 'string', description: 'Restrict to one theme ID' },
      },
      required: ['q'],
    },
  },
];

/** `limit`, clamped — a caller's "1000" must not become the response size. */
function resolveLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** A positive integer, or undefined — never NaN, which Prisma would reject. */
function resolveId(raw: string | undefined): number | undefined {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
}

async function handleSearchKnowledge(args: Record<string, string>): Promise<MCPToolResult> {
  const query = (args.q ?? '').trim();
  if (query.length === 0) {
    return { content: [{ type: 'text', text: 'q is required.' }], isError: true };
  }

  const hits = await searchKnowledgeHybrid({
    query,
    limit: resolveLimit(args.limit),
    category: args.category ? (args.category as KnowledgeCategory) : undefined,
    themeId: resolveId(args.themeId),
    telemetry: { source: 'mcp' },
  });

  if (hits.length === 0) {
    return { content: [{ type: 'text', text: `No knowledge matched "${query}".` }] };
  }

  const lines = hits.map((hit) => {
    // NOTE: similarity is 0 for a lexical-only hit (hybrid-search documents
    // this), so printing it bare would read as "no relevance" for a result the
    // lexical channel was confident about. Name the channel instead.
    const score =
      hit.channel === 'lexical'
        ? `lexical ${(hit.lexicalScore ?? 0).toFixed(2)}`
        : `similarity ${hit.similarity.toFixed(3)}`;
    return [
      `## #${hit.id} ${hit.title}`,
      `${score} · category ${hit.category} · confidence ${hit.confidence.toFixed(2)} · ${hit.forgettingStage}`,
      excerpt(hit.content),
    ].join('\n');
  });

  return {
    content: [
      { type: 'text', text: [`${hits.length} hit(s) for "${query}"`, '', ...lines].join('\n\n') },
    ],
  };
}

/**
 * Run one knowledge tool.
 *
 * @param toolName - The tool to run / 実行するツール名
 * @param args - Tool arguments / ツール引数
 * @returns The result, or null when this module owns no such tool / 結果、未知のツールなら null
 */
export async function executeKnowledgeTool(
  toolName: string,
  args: Record<string, string>,
): Promise<MCPToolResult | null> {
  if (toolName === 'rapitas_search_knowledge') return handleSearchKnowledge(args);
  return null;
}
