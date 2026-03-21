/**
 * agentSettingsTypes
 *
 * Shared type definitions for the agent settings feature.
 * Contains no runtime logic or React imports.
 */

export type AgentConfig = {
  id: number;
  agentType: string;
  name: string;
  endpoint?: string | null;
  modelId?: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilities: Record<string, boolean>;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
};
