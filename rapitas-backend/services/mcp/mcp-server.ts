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
import type { MCPTool, MCPToolResult } from './mcp-types';

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
] as const;

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
  try {
    for (const module of TOOL_MODULES) {
      const result = await module.execute(toolName, args);
      if (result !== null) return result;
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, `[MCP] Tool ${toolName} failed`);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
