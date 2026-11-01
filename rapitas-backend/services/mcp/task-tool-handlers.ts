/**
 * TaskToolHandlers
 *
 * Executes the task, workflow-artifact and theme MCP tools.
 * Not responsible for registration or for error wrapping — the registry in
 * mcp-server.ts owns both.
 */
import { prisma } from '../../config/database';
import type { MCPToolResult } from './mcp-types';

/**
 * Run one task-family tool.
 *
 * @param toolName - The tool to run / 実行するツール名
 * @param args - Tool arguments / ツール引数
 * @returns The result, or null when this module owns no such tool / 結果、未知のツールなら null
 */
export async function executeTaskTool(
  toolName: string,
  args: Record<string, string>,
): Promise<MCPToolResult | null> {
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
      return null;
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
    const res = await fetch(`http://127.0.0.1:3001/workflow/tasks/${taskId}/files`);
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch {
    return { content: [{ type: 'text', text: 'Failed to fetch workflow files.' }], isError: true };
  }
}

async function handleSaveWorkflowFile(args: Record<string, string>): Promise<MCPToolResult> {
  const { taskId, fileType, content } = args;

  try {
    const res = await fetch(`http://127.0.0.1:3001/workflow/tasks/${taskId}/files/${fileType}`, {
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
    // NOTE: toLocaleDateString() below builds an MCP tool-response text line, not a
    // UI datetime display — out of scope for #847.
    ...completed
      .slice(0, 10)
      .map((t) => `- #${t.id} ${t.title} (${t.updatedAt.toLocaleDateString()})`),
  ];

  return { content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }] };
}
