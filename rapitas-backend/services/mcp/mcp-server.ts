/**
 * MCPServer
 *
 * The MCP tool registry: which tools Rapitas exposes, and which module runs
 * each one.
 * Not responsible for any tool's behaviour (the *-tools modules own that) nor
 * for HTTP transport (routes/system/mcp.ts owns that).
 */
import { createLogger } from '../../config/logger';
import { TASK_TOOL_DEFINITIONS } from './task-tool-definitions';
import { executeTaskTool } from './task-tool-handlers';
import { KNOWLEDGE_TOOL_DEFINITIONS, executeKnowledgeTool } from './knowledge-tools';
import { CONCERN_TOOL_DEFINITIONS, executeConcernTool } from './concern-tools';
import { INSIGHT_TOOL_DEFINITIONS, executeInsightTool } from './insight-tools';
import type { MCPTool, MCPToolResult } from './mcp-types';
import { runInWorkspace } from '../tenancy/workspace-context';

const log = createLogger('mcp-server');

// Re-exported so the route files and any existing importer keep their import
// path; the shapes themselves moved to mcp-types.ts when this file became a
// registry (#1318).
export type { MCPTool, MCPToolResult };

/**
 * Every module that owns tools, in the order they are listed to clients.
 *
 * NOTE: A handler returns null for a name it does not own, so a tool added to
 * one module's definitions but not its handler is reachable in `tools/list`
 * and then fails with "Unknown tool" — keep each pair in one module so the two
 * cannot drift apart across files.
 */
const TOOL_MODULES = [
  { definitions: TASK_TOOL_DEFINITIONS, execute: executeTaskTool },
  { definitions: KNOWLEDGE_TOOL_DEFINITIONS, execute: executeKnowledgeTool },
  { definitions: CONCERN_TOOL_DEFINITIONS, execute: executeConcernTool },
  {
    definitions: INSIGHT_TOOL_DEFINITIONS,
    execute: (name: string, args: Record<string, string>) => executeInsightTool(name, args),
  },
] as const;

/** Env var that binds every MCP tool call to one workspace (#1319). */
export const MCP_WORKSPACE_ENV = 'RAPITAS_MCP_WORKSPACE_ID';

/**
 * The workspace MCP tool calls are bound to.
 *
 * MCP clients carry no session cookie, so without this their calls run with no
 * workspace and the scope layer passes them through to every workspace — the
 * deliberate fail-open the agent's own cookieless calls rely on. Unset keeps
 * that behaviour (rows written outside a request have no workspace yet, so
 * binding by default would hide them from MCP). Set, it narrows MCP alone.
 *
 * NOTE: Matched as digits, not parseInt: parseInt reads "2abc" as 2 and
 * "0x2" as 0, and a guard after coercion catches neither.
 *
 * @param env - Environment to read / 参照する環境変数
 * @returns The workspace id, null when unset, or 'invalid' when malformed / 束縛先ワークスペースID
 */
export function resolveMcpWorkspace(env: NodeJS.ProcessEnv): number | null | 'invalid' {
  const raw = env[MCP_WORKSPACE_ENV];
  if (raw === undefined || raw === '') return null;
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 'invalid';
}

/**
 * Get all available MCP tools that Rapitas exposes.
 *
 * @returns Array of MCP tool definitions / MCP ツール定義の配列
 */
export function getToolDefinitions(): MCPTool[] {
  return TOOL_MODULES.flatMap((module) => module.definitions);
}

/**
 * Execute an MCP tool call and return the result.
 *
 * Never throws: a failure comes back as a result with `isError`, which is how
 * MCP wants tool failures surfaced — a JSON-RPC error is for protocol faults.
 *
 * @param toolName - Name of the tool to execute / 実行するツール名
 * @param args - Tool arguments / ツール引数
 * @returns Tool execution result / ツール実行結果
 */
export async function executeTool(
  toolName: string,
  args: Record<string, string>,
): Promise<MCPToolResult> {
  const binding = resolveMcpWorkspace(process.env);
  if (binding === 'invalid') {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${MCP_WORKSPACE_ENV} must be a positive integer workspace id; refusing to run unbound.`,
        },
      ],
      isError: true,
    };
  }
  try {
    const dispatch = async (): Promise<MCPToolResult> => {
      for (const module of TOOL_MODULES) {
        const result = await module.execute(toolName, args);
        if (result !== null) return result;
      }
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    };
    // runInWorkspace, never a hand-written storage.run: its async wrapper is
    // what keeps the context alive into Prisma's hooks (workspace-context.ts).
    return binding === null ? await dispatch() : await runInWorkspace(binding, dispatch);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, `[MCP] Tool ${toolName} failed`);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
