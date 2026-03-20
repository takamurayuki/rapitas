/**
 * Agent Config Service Types
 *
 * Shared request/response interfaces for agent configuration operations.
 * Does not contain any business logic or database access.
 */

/** Request body for creating a new agent configuration. */
export interface CreateAgentConfigRequest {
  agentType: string;
  name: string;
  apiKey?: string;
  endpoint?: string;
  modelId?: string;
  capabilities?: Record<string, boolean>;
  isDefault?: boolean;
}

/** Request body for updating an existing agent configuration. */
export interface UpdateAgentConfigRequest {
  name?: string;
  apiKey?: string;
  endpoint?: string;
  modelId?: string;
  capabilities?: Record<string, boolean>;
  isDefault?: boolean;
}

/** A single field-level validation failure. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Result returned from config validation. */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}
