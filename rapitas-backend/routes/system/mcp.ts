/**
 * MCPRoutes
 *
 * Streamable HTTP transport for the MCP (Model Context Protocol) server, plus
 * the bespoke REST endpoints that predate it.
 * Not responsible for the protocol itself — message dispatch, version
 * negotiation and the Origin rule live in mcp-jsonrpc.ts.
 */
import { Elysia, t } from 'elysia';
import { getToolDefinitions, executeTool } from '../../services/mcp/mcp-server';
import {
  dispatchMcpMessage,
  isOriginAllowed,
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './mcp-jsonrpc';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:mcp');

export const mcpRoutes = new Elysia({ prefix: '/mcp' })
  /**
   * The MCP endpoint. One path serving POST (client messages) and GET (the
   * optional server-to-client SSE stream, which this server does not offer).
   *
   * NOTE: Declared with `parse: 'none'` and parsed here by hand because a
   * malformed body must come back as JSON-RPC -32700, not as Elysia's own
   * validation error — an MCP client cannot interpret the latter.
   */
  .post(
    '/',
    async ({ request, headers, set }) => {
      if (!isOriginAllowed(headers.origin)) {
        // Spec: validate Origin on every connection (DNS rebinding).
        log.warn({ origin: headers.origin }, '[MCP] rejected a non-loopback Origin');
        set.status = 403;
        return { error: 'Forbidden origin' };
      }

      const requested = headers['mcp-protocol-version'];
      if (requested !== undefined && negotiateProtocolVersion(requested) !== requested) {
        // Spec: an unsupported MCP-Protocol-Version MUST be a 400.
        set.status = 400;
        return {
          error: 'Unsupported MCP-Protocol-Version',
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        };
      }

      let message: unknown;
      try {
        // NOTE: Read from the raw Request, not Elysia's `body` — with
        // `parse: 'none'` the latter is not the JSON text.
        message = JSON.parse(await request.text());
      } catch {
        set.status = 400;
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }

      const outcome = await dispatchMcpMessage(message);
      // A notification is answered with 202 and genuinely no body, so the
      // Response is built directly rather than letting Elysia serialize null.
      if (outcome.body === null) return new Response(null, { status: outcome.status });
      set.status = outcome.status;
      return outcome.body;
    },
    { parse: 'none' },
  )

  /**
   * The optional server-initiated SSE stream. This server never pushes
   * messages, and the spec's prescribed answer for that is 405 — the measured
   * Claude Code client accepts it and carries on.
   */
  .get('/', ({ set }) => {
    set.status = 405;
    return { error: 'This MCP endpoint does not offer an SSE stream' };
  })

  /**
   * Explicit session termination. No session is issued (this server is
   * stateless), so there is nothing to terminate.
   */
  .delete('/', ({ set }) => {
    set.status = 405;
    return { error: 'This MCP endpoint does not use sessions' };
  })
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
