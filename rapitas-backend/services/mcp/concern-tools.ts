/**
 * ConcernTools
 *
 * Lets an MCP client file a concern into the backlog without leaving its
 * editor.
 * Not responsible for deduplication or the anti-monoculture gates — those are
 * submitConcern's, and this module only reports what it decided.
 */
import { submitConcern } from '../memory/concern-backlog-service';
import {
  CONCERN_SEVERITIES,
  CONCERN_TYPES,
  normalizeConcernSeverity,
  normalizeConcernType,
} from '../memory/concern-backlog-types';
import type { MCPTool, MCPToolResult } from './mcp-types';

/**
 * Marks rows that arrived over MCP, so the share of externally filed concerns
 * is measurable rather than guessed at.
 */
const MCP_SOURCE = 'mcp';

/** The concern tools this module owns. */
export const CONCERN_TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: 'rapitas_create_concern',
    description:
      'File a concern (bug, refactor, security, perf) into the Rapitas backlog. ' +
      'Search with rapitas_search_knowledge first — a near-duplicate is merged ' +
      'into the existing concern rather than filed again.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'One line naming the problem' },
        detail: {
          type: 'string',
          description: 'What is wrong, where, and how it was observed',
        },
        type: {
          type: 'string',
          description: 'Kind of concern',
          enum: [...CONCERN_TYPES],
        },
        severity: {
          type: 'string',
          description: 'How urgent',
          enum: [...CONCERN_SEVERITIES],
        },
        location: { type: 'string', description: 'File path, module, or URL' },
      },
      required: ['title', 'detail'],
    },
  },
];

async function handleCreateConcern(args: Record<string, string>): Promise<MCPToolResult> {
  const title = (args.title ?? '').trim();
  const detail = (args.detail ?? '').trim();
  if (title.length === 0 || detail.length === 0) {
    return {
      content: [{ type: 'text', text: 'title and detail are both required.' }],
      isError: true,
    };
  }

  const filing = await submitConcern({
    title,
    detail,
    type: normalizeConcernType(args.type),
    severity: normalizeConcernSeverity(args.severity),
    location: args.location?.trim() || undefined,
    source: MCP_SOURCE,
  });

  // NOTE: `stored` is false whenever the filing was merged into an existing
  // concern or suppressed. Reporting only the id would read as success and the
  // caller would believe it filed something new — say which happened, because
  // the difference changes what the caller should do next.
  const text = filing.stored
    ? `Filed concern #${filing.id}: ${title}`
    : `Not filed as new (${filing.outcome} / ${filing.reason})${
        filing.id === null ? '.' : ` — see existing concern #${filing.id}.`
      }`;

  return { content: [{ type: 'text', text }] };
}

/**
 * Run one concern tool.
 *
 * @param toolName - The tool to run / 実行するツール名
 * @param args - Tool arguments / ツール引数
 * @returns The result, or null when this module owns no such tool / 結果、未知のツールなら null
 */
export async function executeConcernTool(
  toolName: string,
  args: Record<string, string>,
): Promise<MCPToolResult | null> {
  if (toolName === 'rapitas_create_concern') return handleCreateConcern(args);
  return null;
}
