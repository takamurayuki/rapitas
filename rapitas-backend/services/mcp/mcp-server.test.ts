/**
 * mcp-server.test
 *
 * The registry is where a tool goes missing silently: a definition listed by
 * one module whose handler lives in another returns null from every handler
 * and surfaces as "Unknown tool" only when a client actually calls it. These
 * tests pin that every listed tool is reachable, and that a handler that
 * throws cannot take the transport down with it.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import type { MCPTool, MCPToolResult } from './mcp-types';

function definition(name: string): MCPTool {
  return { name, description: name, inputSchema: { type: 'object', properties: {} } };
}

function ran(name: string): MCPToolResult {
  return { content: [{ type: 'text', text: `ran ${name}` }] };
}

const TASK_TOOL_DEFINITIONS = [definition('rapitas_list_tasks')];
const KNOWLEDGE_TOOL_DEFINITIONS = [definition('rapitas_search_knowledge')];
const CONCERN_TOOL_DEFINITIONS = [definition('rapitas_create_concern')];

let taskThrows = false;

const executeTaskTool = mock(async (name: string): Promise<MCPToolResult | null> => {
  if (taskThrows) throw new Error('prisma exploded');
  return name === 'rapitas_list_tasks' ? ran(name) : null;
});
const executeKnowledgeTool = mock(
  async (name: string): Promise<MCPToolResult | null> =>
    name === 'rapitas_search_knowledge' ? ran(name) : null,
);
const executeConcernTool = mock(
  async (name: string): Promise<MCPToolResult | null> =>
    name === 'rapitas_create_concern' ? ran(name) : null,
);

// Each tool module has exactly these runtime exports; all are mirrored.
mock.module('./task-tool-definitions', () => ({ TASK_TOOL_DEFINITIONS }));
mock.module('./task-tool-handlers', () => ({ executeTaskTool }));
mock.module('./knowledge-tools', () => ({ KNOWLEDGE_TOOL_DEFINITIONS, executeKnowledgeTool }));
mock.module('./concern-tools', () => ({ CONCERN_TOOL_DEFINITIONS, executeConcernTool }));

const { getToolDefinitions, executeTool } = await import('./mcp-server');

beforeEach(() => {
  taskThrows = false;
  executeTaskTool.mockClear();
  executeKnowledgeTool.mockClear();
  executeConcernTool.mockClear();
});

describe('getToolDefinitions', () => {
  it('lists every module, tasks first', () => {
    expect(getToolDefinitions().map((t) => t.name)).toEqual([
      'rapitas_list_tasks',
      'rapitas_search_knowledge',
      'rapitas_create_concern',
    ]);
  });

  it('gives every listed tool a reachable handler', async () => {
    for (const tool of getToolDefinitions()) {
      const result = await executeTool(tool.name, {});
      expect(result.isError).toBeUndefined();
    }
  });
});

describe('executeTool', () => {
  it('routes to the module that owns the tool', async () => {
    expect((await executeTool('rapitas_search_knowledge', {})).content[0].text).toBe(
      'ran rapitas_search_knowledge',
    );
    expect(executeConcernTool).not.toHaveBeenCalled();
  });

  it('stops at the first module that claims the tool', async () => {
    await executeTool('rapitas_list_tasks', {});
    expect(executeTaskTool).toHaveBeenCalledTimes(1);
    expect(executeKnowledgeTool).not.toHaveBeenCalled();
  });

  it('reports an unknown tool as an error result', async () => {
    const result = await executeTool('rapitas_nonexistent', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  // A throw here would escape into the JSON-RPC dispatch and come back as a
  // protocol fault, which tells a client the server is broken rather than
  // that one tool failed.
  it('turns a handler throw into an error result instead of propagating', async () => {
    taskThrows = true;
    const result = await executeTool('rapitas_list_tasks', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('prisma exploded');
  });

  it('passes the arguments through unchanged', async () => {
    await executeTool('rapitas_create_concern', { title: 't', detail: 'd' });
    expect(executeConcernTool).toHaveBeenCalledWith('rapitas_create_concern', {
      title: 't',
      detail: 'd',
    });
  });
});
