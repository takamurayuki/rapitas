// Routes Agents barrel export - 全サブディレクトリのexport + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { approvalsRoutes } from './integrations/approvals';
import { aiAgentRoutes } from './integrations/ai-agent';
import { cliToolsManagementRoutes } from './integrations/cli-tools-management';
import { agentExecutionConfigRoutes } from './config/agent-execution-config';
import { agentAvailabilityRoutes } from './config/agent-availability';
import { providerCooldownsRoutes } from './config/provider-cooldowns';
import { recoveryMetricsRoutes } from './config/recovery-metrics';
import { errorDiagnosisRoutes } from './config/error-diagnosis';
import { probeMetricsRoutes } from './config/probe-metrics';
import { executionLogsRoutes } from './monitoring/execution-logs';
import { agentMetricsRouter } from './monitoring/agent-metrics';
import { agentVersionManagementRoutes } from './system/agent-version-management';
import { smartRouterRoutes } from './system/smart-router-routes';
import { executionForkRoutes } from './execution-management/execution-fork-routes';
import { previewRoutes } from './preview/preview-routes';

export * from './crud';
export * from './config';
export * from './execution-management';
export * from './monitoring';
export * from './system';
export * from './integrations';
export * from './preview/preview-routes';

export const agentsDomainRoutes = new Elysia()
  .use(approvalsRoutes)
  .use(aiAgentRoutes)
  .use(cliToolsManagementRoutes)
  .use(agentExecutionConfigRoutes)
  .use(agentAvailabilityRoutes)
  .use(providerCooldownsRoutes)
  .use(recoveryMetricsRoutes)
  .use(errorDiagnosisRoutes)
  .use(probeMetricsRoutes)
  .use(executionLogsRoutes)
  .use(agentMetricsRouter)
  .use(agentVersionManagementRoutes)
  .use(smartRouterRoutes)
  .use(executionForkRoutes)
  .use(previewRoutes);
