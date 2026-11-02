/**
 * TaskToolDefinitions
 *
 * The MCP tool definitions for tasks, workflow artifacts and themes.
 * Declaration only — the handlers live in task-tool-handlers.ts.
 */
import type { MCPTool } from './mcp-types';

export const TASK_TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: 'rapitas_list_tasks',
    description: 'List tasks with optional filters (status, theme, category)',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['todo', 'in-progress', 'done', 'waiting'],
        },
        themeId: { type: 'string', description: 'Filter by theme ID' },
        limit: { type: 'string', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'rapitas_get_task',
    description: 'Get detailed information about a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rapitas_create_task',
    description: 'Create a new task in Rapitas',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        themeId: { type: 'string', description: 'Theme ID to assign to' },
        priority: {
          type: 'string',
          description: 'Priority level',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'rapitas_update_task_status',
    description: 'Update the status of a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['todo', 'in-progress', 'done', 'waiting'],
        },
      },
      required: ['taskId', 'status'],
    },
  },
  {
    name: 'rapitas_get_workflow_files',
    description: 'Get workflow files (research.md, plan.md, verify.md) for a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rapitas_save_workflow_file',
    description: 'Save a workflow file for a task (research, plan, or verify)',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        fileType: {
          type: 'string',
          description: 'File type',
          enum: ['research', 'plan', 'verify', 'question'],
        },
        content: { type: 'string', description: 'File content in markdown' },
      },
      required: ['taskId', 'fileType', 'content'],
    },
  },
  {
    name: 'rapitas_list_themes',
    description: 'List all themes (project categories)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'rapitas_get_progress_summary',
    description: 'Get a progress summary of recent task completions',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'string', description: 'Number of days to look back (default 7)' },
      },
    },
  },
];
