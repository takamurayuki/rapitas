/**
 * MCPRoutes
 *
 * HTTP transport layer for the MCP (Model Context Protocol) server.
 * Exposes tool listing and tool execution endpoints for IDE integration.
 */
import { Elysia, t } from 'elysia';
import { getToolDefinitions, executeTool } from '../../services/mcp/mcp-server';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:mcp');

export const mcpRoutes = new Elysia({ prefix: '/mcp' })
  /**
   * List all available MCP tools.
   */
  .get('/tools', () => {
    return {
      success: true,
      data: { tools: getToolDefinitions() },
    };
  })

  /**
   * Execute an MCP tool call.
   */
  .post(
    '/tools/call',
    async (context) => {
      const { body } = context;
      const { name, arguments: args } = body as { name: string; arguments: Record<string, string> };

      log.info(`[MCP] Tool call: ${name}`);
      const result = await executeTool(name, args || {});

      return {
        success: !result.isError,
        data: result,
      };
    },
    {
      body: t.Object({
        name: t.String(),
        arguments: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )

  /**
   * MCP server info (for discovery/handshake).
   */
  .get('/info', () => {
    return {
      name: 'rapitas',
      version: '1.0.0',
      description: 'Rapitas AI Task Management - MCP Server',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false,
      },
    };
  });
