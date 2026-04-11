/**
 * MCPServer
 *
 * Exposes Rapitas task and workflow operations as MCP (Model Context Protocol) tools.
 * Enables IDE integration with Cursor, Claude Code, Windsurf, etc.
 * Not responsible for HTTP API — that is handled by Elysia routes.
 */
import { createLogger } from '../../config/logger';
import { prisma } from '../../config/database';

const log = createLogger('mcp-server');

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

/**
 * Get all available MCP tools that Rapitas exposes.
 *
 * @returns Array of MCP tool definitions / MCP ツール定義の配列
 */
export function getToolDefinitions(): MCPTool[] {
  return [
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
}

/**
 * Execute an MCP tool call and return the result.
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
    switch (toolName) {
      case 'rapitas_list_tasks':
        return await handleListTasks(args);
      case 'rapitas_get_task':
        return await handleGetTask(args);
      case 'rapitas_create_task':
        return await handleCreateTask(args);
      case 'rapitas_update_task_status':
        return await handleUpdateTaskStatus(args);
      case 'rapitas_get_workflow_files':
        return await handleGetWorkflowFiles(args);
      case 'rapitas_save_workflow_file':
        return await handleSaveWorkflowFile(args);
      case 'rapitas_list_themes':
        return await handleListThemes();
      case 'rapitas_get_progress_summary':
        return await handleGetProgressSummary(args);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, `[MCP] Tool ${toolName} failed`);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}

async function handleListTasks(args: Record<string, string>): Promise<MCPToolResult> {
  const where: Record<string, unknown> = {};
  if (args.status) where.status = args.status;
  if (args.themeId) where.themeId = parseInt(args.themeId);

  const tasks = await prisma.task.findMany({
    where,
    take: parseInt(args.limit || '20'),
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, status: true, priority: true, themeId: true, updatedAt: true },
  });

  const text = tasks
    .map((t) => `#${t.id} [${t.status}] ${t.title} (priority: ${t.priority})`)
    .join('\n');
  return { content: [{ type: 'text', text: text || 'No tasks found.' }] };
}

async function handleGetTask(args: Record<string, string>): Promise<MCPToolResult> {
  const task = await prisma.task.findUnique({
    where: { id: parseInt(args.taskId) },
    include: { theme: true, subtasks: { select: { id: true, title: true, status: true } } },
  });

  if (!task) return { content: [{ type: 'text', text: 'Task not found.' }], isError: true };

  const lines = [
    `# Task #${task.id}: ${task.title}`,
    `Status: ${task.status} | Priority: ${task.priority}`,
    task.description ? `\nDescription:\n${task.description}` : '',
    task.theme ? `Theme: ${task.theme.name}` : '',
    task.subtasks.length > 0
      ? `\nSubtasks:\n${task.subtasks.map((s) => `  - #${s.id} [${s.status}] ${s.title}`).join('\n')}`
      : '',
  ];

  return { content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }] };
}

async function handleCreateTask(args: Record<string, string>): Promise<MCPToolResult> {
  const task = await prisma.task.create({
    data: {
      title: args.title,
      description: args.description || null,
      themeId: args.themeId ? parseInt(args.themeId) : null,
      priority: args.priority || 'medium',
      status: 'todo',
    },
  });

  return { content: [{ type: 'text', text: `Created task #${task.id}: ${task.title}` }] };
}

async function handleUpdateTaskStatus(args: Record<string, string>): Promise<MCPToolResult> {
  const task = await prisma.task.update({
    where: { id: parseInt(args.taskId) },
    data: { status: args.status },
  });

  return {
    content: [{ type: 'text', text: `Updated task #${task.id} status to: ${task.status}` }],
  };
}

async function handleGetWorkflowFiles(args: Record<string, string>): Promise<MCPToolResult> {
  const taskId = parseInt(args.taskId);

  // NOTE: Use internal API to get workflow files consistently
  try {
    const res = await fetch(`http://localhost:3001/workflow/tasks/${taskId}/files`);
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch {
    return { content: [{ type: 'text', text: 'Failed to fetch workflow files.' }], isError: true };
  }
}

async function handleSaveWorkflowFile(args: Record<string, string>): Promise<MCPToolResult> {
  const { taskId, fileType, content } = args;

  try {
    const res = await fetch(`http://localhost:3001/workflow/tasks/${taskId}/files/${fileType}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch {
    return { content: [{ type: 'text', text: 'Failed to save workflow file.' }], isError: true };
  }
}

async function handleListThemes(): Promise<MCPToolResult> {
  const themes = await prisma.theme.findMany({
    include: { _count: { select: { tasks: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const text = themes.map((t) => `#${t.id} ${t.name} (${t._count.tasks} tasks)`).join('\n');
  return { content: [{ type: 'text', text: text || 'No themes found.' }] };
}

async function handleGetProgressSummary(args: Record<string, string>): Promise<MCPToolResult> {
  const days = parseInt(args.days || '7');
  const since = new Date();
  since.setDate(since.getDate() - days);

  const completed = await prisma.task.findMany({
    where: { status: 'done', updatedAt: { gte: since } },
    select: { id: true, title: true, updatedAt: true, actualHours: true },
    orderBy: { updatedAt: 'desc' },
  });

  const inProgress = await prisma.task.count({ where: { status: 'in-progress' } });
  const todo = await prisma.task.count({ where: { status: 'todo' } });

  const totalHours = completed.reduce((sum, t) => sum + (t.actualHours || 0), 0);

  const lines = [
    `# Progress Summary (last ${days} days)`,
    `Completed: ${completed.length} tasks (${totalHours.toFixed(1)} hours)`,
    `In Progress: ${inProgress} | Todo: ${todo}`,
    '',
    completed.length > 0 ? '## Recently Completed' : '',
    ...completed
      .slice(0, 10)
      .map((t) => `- #${t.id} ${t.title} (${t.updatedAt.toLocaleDateString()})`),
  ];

  return { content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }] };
}
