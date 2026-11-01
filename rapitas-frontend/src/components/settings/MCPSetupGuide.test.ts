/**
 * MCPSetupGuide.test
 *
 * These snippets are instructions the user copies into another program, so a
 * mistake in them is invisible here and only fails in their editor. Two wrong
 * ones shipped that way (#1316): `transport: "http"` is not a recognised key,
 * and a stdio entry running `curl` cannot complete the handshake at all.
 *
 * What this can catch: a snippet that stops being valid JSON, loses the
 * transport type, or points somewhere other than the MCP endpoint.
 * What it cannot: whether a real client accepts it. That was verified by
 * connecting Claude Code 2.1.316 to the endpoint, which listed all eight
 * rapitas tools — a check no unit test can stand in for.
 */
import { describe, expect, it } from 'vitest';
import { MCP_CONFIG, CLAUDE_CODE_CONFIG } from './MCPSetupGuide';

const MCP_ENDPOINT = 'http://127.0.0.1:3001/mcp';

describe('MCP_CONFIG', () => {
  it('is valid JSON — it is pasted into a config file verbatim', () => {
    expect(() => JSON.parse(MCP_CONFIG)).not.toThrow();
  });

  it('declares the rapitas server over the http transport', () => {
    const parsed = JSON.parse(MCP_CONFIG) as {
      mcpServers: Record<string, { type?: string; url?: string; command?: string }>;
    };
    const server = parsed.mcpServers.rapitas;

    expect(server).toBeDefined();
    expect(server.type).toBe('http');
    expect(server.url).toBe(MCP_ENDPOINT);
    // The broken snippet was a stdio entry; a `command` here means that
    // mistake has come back.
    expect(server.command).toBeUndefined();
  });

  it('names no key the clients do not read', () => {
    const parsed = JSON.parse(MCP_CONFIG) as { mcpServers: Record<string, object> };
    expect(Object.keys(parsed.mcpServers.rapitas).sort()).toEqual(['type', 'url']);
  });
});

describe('CLAUDE_CODE_CONFIG', () => {
  it('is the one-command form, pointing at the MCP endpoint', () => {
    expect(CLAUDE_CODE_CONFIG).toBe(`claude mcp add --transport http rapitas ${MCP_ENDPOINT}`);
  });

  it('does not instruct the user to edit a config path by hand', () => {
    // The old snippet named `~/.claude/claude_desktop_config.json`, which is
    // neither Claude Code's path nor Claude Desktop's.
    expect(CLAUDE_CODE_CONFIG).not.toContain('claude_desktop_config.json');
  });
});
