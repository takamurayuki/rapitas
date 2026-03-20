/**
 * AI Agent Main Router
 *
 * Aggregates all agent sub-routers. Route implementations live in dedicated modules:
 *   - agent-config-router     — agent configuration CRUD (migrated)
 *   - agent-execution-router  — task execution start/stop
 *   - agent-session-router    — session management
 *   - agent-audit-router      — audit log and task execution logs
 *   - agent-system-router     — system-level operations
 *   - agent-crud-router       — agent record CRUD (create/read/update/delete)
 *   - agent-api-key-router    — API key storage and deletion
 *   - agent-test-router       — connection test endpoints (legacy + new)
 *   - agent-discovery-router  — agent types, models, and preset setup
 *   - agent-resume-router     — interrupted execution resumption + executing-tasks list
 */
import { Elysia } from 'elysia';

import { agentConfigRouter } from '../config/agent-config-router';
import { agentExecutionRouter } from '../execution-management/agent-execution-router';
import { agentSessionRouter } from '../crud/agent-session-router';
import { agentAuditRouter, taskExecutionLogsRouter } from '../monitoring/agent-audit-router';
import { agentSystemRouter } from '../system/agent-system-router';
import { agentCrudRouter } from '../crud/agent-crud-router';
import { agentApiKeyRouter } from '../config/agent-api-key-router';
import { agentTestRouter } from '../monitoring/agent-test-router';
import { agentDiscoveryRouter } from '../crud/agent-discovery-router';
import { agentResumeRouter } from '../execution-management/agent-resume-router';

export const aiAgentRoutes = new Elysia()
  .use(agentConfigRouter)
  .use(agentExecutionRouter)
  .use(agentSessionRouter)
  .use(agentAuditRouter)
  .use(taskExecutionLogsRouter)
  .use(agentSystemRouter)
  .use(agentCrudRouter)
  .use(agentApiKeyRouter)
  .use(agentTestRouter)
  .use(agentDiscoveryRouter)
  .use(agentResumeRouter);
