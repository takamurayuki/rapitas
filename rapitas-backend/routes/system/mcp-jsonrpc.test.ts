/**
 * mcp-jsonrpc.test
 *
 * What this pins was measured, not assumed (#1316). Against a logging probe
 * server, the installed Claude Code 2.1.316 does one of two things:
 *
 *   - correct `server/discover` reply -> it stays on 2026-07-28 and sends
 *     `tools/list` next; no `initialize`, no `notifications/initialized`.
 *   - wrong/absent `server/discover` -> it falls back to the handshake and
 *     sends `initialize` with protocolVersion `2025-11-25`.
 *
 * Both paths therefore have to work, and the first test below is the one that
 * was red before this module existed: `POST /mcp` with a real MCP message
 * answered 404 because the route only spoke a bespoke REST shape.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';

const getToolDefinitions = mock(() => [
  {
    name: 'rapitas_list_tasks',
    description: 'List tasks',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'rapitas_get_task',
    description: 'Get one task',
    inputSchema: { type: 'object' as const, properties: {} },
  },
]);
const executeTool = mock(async (name: string) => ({
  content: [{ type: 'text' as const, text: `ran ${name}` }],
}));

// NOTE: Bun's mock.module replaces the whole module, so both runtime exports
// are mirrored — a missing one makes this file stop with one error and its
// tests vanish rather than fail (CLAUDE.md § Adding an export to a module).
mock.module('../../services/mcp/mcp-server', () => ({ getToolDefinitions, executeTool }));

const {
  dispatchMcpMessage,
  negotiateProtocolVersion,
  isOriginAllowed,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} = await import('./mcp-jsonrpc');

beforeEach(() => {
  getToolDefinitions.mockClear();
  executeTool.mockClear();
});

describe('server/discover', () => {
  it('answers with the shape that keeps a 2026-07-28 client off the handshake', async () => {
    const out = await dispatchMcpMessage({
      jsonrpc: '2.0',
      id: 'server-discover-probe-1',
      method: 'server/discover',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    });

    expect(out.status).toBe(200);
    const result = out.body?.result as Record<string, unknown>;
    expect(out.body?.id).toBe('server-discover-probe-1');
    expect(result.resultType).toBe('complete');
    // The probe proved the key name matters: `protocolVersions` made the real
    // client fall back to `initialize`; `supportedVersions` did not.
    expect(result.supportedVersions).toContain('2026-07-28');
    expect(result.capabilities).toEqual({ tools: {} });
    const meta = result._meta as Record<string, { name: string }>;
    expect(meta['io.modelcontextprotocol/serverInfo'].name).toBe('rapitas');
  });
});

describe('initialize', () => {
  it('echoes a protocol version it supports', async () => {
    const out = await dispatchMcpMessage({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x' } },
    });

    const result = out.body?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-11-25');
    expect(result.capabilities).toEqual({ tools: {} });
    expect((result.serverInfo as { name: string }).name).toBe('rapitas');
  });

  it('answers an unsupported version with its own latest instead of an error', async () => {
    const out = await dispatchMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0.0' },
    });

    expect(out.body?.error).toBeUndefined();
    expect((out.body?.result as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });

  it('answers a missing protocolVersion with its own latest', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize' });
    expect((out.body?.result as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });
});

describe('notifications', () => {
  // The spec requires 202 with no body for a notification. The measured
  // handshake sends `notifications/initialized` right after `initialize`.
  it('accepts a notification with 202 and no body', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(out.status).toBe(202);
    expect(out.body).toBeNull();
  });

  it('accepts an unknown notification too, rather than erroring', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', method: 'notifications/cancelled' });
    expect(out.status).toBe(202);
    expect(out.body).toBeNull();
  });
});

describe('tools', () => {
  it('lists the tool definitions the service already exposes', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const result = out.body?.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name)).toEqual(['rapitas_list_tasks', 'rapitas_get_task']);
  });

  it('calls a tool and returns its content', async () => {
    const out = await dispatchMcpMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'rapitas_list_tasks', arguments: { status: 'todo' } },
    });

    expect(executeTool).toHaveBeenCalledWith('rapitas_list_tasks', { status: 'todo' });
    const result = out.body?.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('ran rapitas_list_tasks');
  });

  it('defaults absent arguments to an empty object', async () => {
    await dispatchMcpMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'rapitas_list_themes' },
    });
    expect(executeTool).toHaveBeenCalledWith('rapitas_list_themes', {});
  });

  it('rejects a tools/call with no tool name as invalid params', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call' });
    expect(out.body?.error?.code).toBe(-32602);
    expect(executeTool).not.toHaveBeenCalled();
  });
});

describe('protocol errors', () => {
  it('answers ping with an empty result', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(out.body?.result).toEqual({});
  });

  it('reports an unknown method as -32601', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
    expect(out.status).toBe(200);
    expect(out.body?.error?.code).toBe(-32601);
  });

  it('reports a message that is not JSON-RPC 2.0 as -32600 with HTTP 400', async () => {
    const out = await dispatchMcpMessage({ id: 9, method: 'tools/list' });
    expect(out.status).toBe(400);
    expect(out.body?.error?.code).toBe(-32600);
  });

  it('reports a message with no method as -32600', async () => {
    const out = await dispatchMcpMessage({ jsonrpc: '2.0', id: 10 });
    expect(out.status).toBe(400);
    expect(out.body?.error?.code).toBe(-32600);
  });
});

describe('negotiateProtocolVersion', () => {
  it('keeps every supported revision', () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(version)).toBe(version);
    }
  });

  it('falls back to the latest for anything else', () => {
    expect(negotiateProtocolVersion('2019-01-01')).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe('isOriginAllowed', () => {
  // The spec requires Origin validation on every Streamable HTTP connection:
  // without it a page on any website can drive this loopback server through
  // the browser (DNS rebinding).
  it('allows a request with no Origin — the measured CLI client sends none', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
  });

  it('allows loopback origins', () => {
    expect(isOriginAllowed('http://127.0.0.1:3000')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
    expect(isOriginAllowed('http://[::1]:3000')).toBe(true);
  });

  it('rejects a remote origin', () => {
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    expect(isOriginAllowed('http://192.168.1.10:3000')).toBe(false);
  });

  it('rejects a hostname that merely contains localhost', () => {
    expect(isOriginAllowed('http://localhost.evil.example.com')).toBe(false);
  });

  it('rejects an unparseable Origin rather than letting it through', () => {
    expect(isOriginAllowed('not a url')).toBe(false);
  });
});
