/**
 * MCPJsonRpc
 *
 * Speaks MCP's JSON-RPC 2.0 message layer over the tool surface already
 * implemented in services/mcp/mcp-server, and guards the Streamable HTTP
 * transport's Origin header.
 * Not responsible for HTTP framing — it returns the status code for mcp.ts to
 * apply, so the dispatch stays pure and testable without a server.
 */
import { getToolDefinitions, executeTool } from '../../services/mcp/mcp-server';

/**
 * Revisions this server will negotiate, newest first.
 *
 * NOTE: Measured against the installed Claude Code 2.1.316 (#1316): with a
 * correct `server/discover` reply it stays on 2026-07-28 and never sends
 * `initialize`; with a wrong one it falls back to the handshake at 2025-11-25.
 * Both revisions therefore have to be here, and the older three are kept so an
 * older client (Cursor, Claude Desktop) can still negotiate down.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

/** One of the revisions in {@link SUPPORTED_PROTOCOL_VERSIONS}. */
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** The newest revision this server speaks. */
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Self-reported identity. The spec marks this as display/debug only — clients
 * are told not to make security decisions from it.
 */
const SERVER_INFO = { name: 'rapitas', title: 'Rapitas', version: '1.0.0' } as const;

/** Only tools are offered; resources and prompts are not implemented. */
const SERVER_CAPABILITIES = { tools: {} } as const;

/** Natural-language guidance the client may pass to its model. */
const INSTRUCTIONS =
  "Rapitas owns this user's tasks, workflow artifacts (research/plan/verify) and themes. " +
  'Search existing tasks with rapitas_list_tasks before creating one, so work is not filed twice.';

/** A JSON-RPC error object. */
export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** A JSON-RPC response. Exactly one of `result` / `error` is set. */
export interface JsonRpcResponseBody {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

/** What the transport should send back. `body` is null for a bodiless 202. */
export interface McpDispatchOutcome {
  status: number;
  body: JsonRpcResponseBody | null;
}

/** Hostnames that count as this machine, for the Origin check. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `id` to echo, or null when the message carries none we can use. */
function readId(message: unknown): string | number | null {
  if (!isPlainObject(message)) return null;
  const { id } = message;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function ok(id: string | number | null, result: unknown): McpDispatchOutcome {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function fail(
  id: string | number | null,
  code: number,
  message: string,
  status = 200,
): McpDispatchOutcome {
  return { status, body: { jsonrpc: '2.0', id, error: { code, message } } };
}

/**
 * The revision to answer with.
 *
 * Version negotiation is not an error path: the spec says a server that does
 * not support the requested revision MUST answer with one it does support,
 * and the client decides whether to disconnect.
 *
 * @param requested - The client's requested revision / クライアントの要求リビジョン
 * @returns A supported revision — the requested one when possible / 対応リビジョン
 */
export function negotiateProtocolVersion(requested: unknown): ProtocolVersion {
  const candidates: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;
  return typeof requested === 'string' && candidates.includes(requested)
    ? (requested as ProtocolVersion)
    : LATEST_PROTOCOL_VERSION;
}

/**
 * Whether a request's `Origin` may drive this server.
 *
 * NOTE: Required by the transport spec. Without it any web page the user visits
 * could reach this loopback-only API through their browser (DNS rebinding) and
 * call the write tools. A request with no Origin is allowed because that is
 * what a CLI client sends — measured on Claude Code 2.1.316, which sends none.
 *
 * @param origin - The request's Origin header, if any / リクエストの Origin ヘッダー
 * @returns true when the origin is absent or loopback / 不在かループバックなら true
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (origin === undefined || origin === null || origin === '') return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    // An Origin we cannot parse is not an Origin we can vouch for.
    return false;
  }
}

/** The `server/discover` result (2026-07-28 and later). */
function discoverResult(): Record<string, unknown> {
  return {
    resultType: 'complete',
    supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    capabilities: SERVER_CAPABILITIES,
    // NOTE: serverInfo lives under this `_meta` key in 2026-07-28, not at the
    // top level as in the handshake's InitializeResult. Naming it
    // `protocolVersions` instead of `supportedVersions` was what made the real
    // client fall back to `initialize` while this was being measured.
    _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
    instructions: INSTRUCTIONS,
  };
}

/** The handshake `initialize` result (2025-11-25 and earlier). */
function initializeResult(params: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
    capabilities: SERVER_CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
): Promise<McpDispatchOutcome> {
  const name = params?.name;
  if (typeof name !== 'string' || name.length === 0) {
    return fail(id, -32602, 'Invalid params: tools/call requires a tool name');
  }
  const rawArgs = params?.arguments;
  const args: Record<string, string> = {};
  if (isPlainObject(rawArgs)) {
    for (const [key, value] of Object.entries(rawArgs)) {
      args[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  // NOTE: executeTool reports a tool failure as `isError` in the result and
  // never throws, which is also how MCP wants tool errors surfaced — a
  // JSON-RPC error is for protocol faults, not for a tool that ran and failed.
  return ok(id, await executeTool(name, args));
}

/**
 * Dispatch one MCP JSON-RPC message.
 *
 * @param message - The parsed request body / パース済みリクエストボディ
 * @returns The status and body the transport should return / 返すべきステータスとボディ
 */
export async function dispatchMcpMessage(message: unknown): Promise<McpDispatchOutcome> {
  if (!isPlainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return fail(readId(message), -32600, 'Invalid Request', 400);
  }

  // A message with no `id` member is a notification: the spec requires 202
  // Accepted with no body, never a response.
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return { status: 202, body: null };
  }

  const id = readId(message);
  const params = isPlainObject(message.params) ? message.params : undefined;

  switch (message.method) {
    case 'server/discover':
      return ok(id, discoverResult());
    case 'initialize':
      return ok(id, initializeResult(params));
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: getToolDefinitions() });
    case 'tools/call':
      return callTool(id, params);
    default:
      return fail(id, -32601, `Method not found: ${message.method}`);
  }
}
