/**
 * MCPTypes
 *
 * The MCP tool-definition and tool-result shapes, shared by every tool module.
 * Kept separate so a tool module does not have to import the registry it is
 * registered into.
 */

/** MCP tool definition following the Model Context Protocol spec. */
export type MCPTool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
};

/** MCP tool call result. */
export type MCPToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};
