/**
 * workflow.types
 *
 * Type definitions for the agent workflow system: statuses, file types, roles, and role configs.
 * Does not include agent execution types; see agent.types.ts for those.
 */

export type WorkflowStatus =
  | 'draft'
  | 'research_done'
  | 'plan_created'
  | 'plan_approved'
  | 'in_progress'
  | 'verify_done'
  | 'completed';

export type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

export type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';

export type WorkflowFile = {
  type: WorkflowFileType;
  exists: boolean;
  content?: string;
  lastModified?: string;
  size?: number;
};

export type WorkflowPathInfo = {
  taskId: number;
  categoryId: number | null;
  themeId: number | null;
  dir: string;
};

export type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';

export type WorkflowRoleConfig = {
  id: number;
  role: WorkflowRole;
  agentConfigId: number | null;
  agentConfig?: {
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    isActive: boolean;
  } | null;
  modelId: string | null;
  systemPromptKey: string | null;
  isEnabled: boolean;
  metadata: string;
};
