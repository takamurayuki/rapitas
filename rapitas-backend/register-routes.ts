// register-routes.ts — Mounts all modular routes onto the Elysia app.
// Extracted from index.ts to keep the entry point under 300 lines.
//
// Routes are registered per-domain: each domain barrel (routes/<domain>/index.ts)
// exports a single merged `<domain>DomainRoutes` instance, so adding a route to an
// existing domain never touches this file, and adding a new domain touches it once
// (see task #675 — this used to be a 108-line import + 108-call app.use() list that
// every new feature had to append to, guaranteeing merge conflicts).
import type { Elysia } from 'elysia';
import { organizationDomainRoutes } from './routes/organization';
import { tasksDomainRoutes } from './routes/tasks';
import { agentsDomainRoutes } from './routes/agents';
import { aiDomainRoutes } from './routes/ai';
import { schedulingDomainRoutes } from './routes/scheduling';
import { learningDomainRoutes } from './routes/learning';
import { systemDomainRoutes } from './routes/system';
import { workflowDomainRoutes } from './routes/workflow';
import { socialDomainRoutes } from './routes/social';
import { analyticsDomainRoutes } from './routes/analytics';
import { lifestyleDomainRoutes } from './routes/lifestyle';
import { memoryDomainRoutes } from './routes/memory';
import { selfImprovementDomainRoutes } from './routes/self-improvement';
import { selfLearningDomainRoutes } from './routes/self-learning';

/**
 * Register all modular routes on the Elysia application instance.
 */
export function registerAllRoutes(app: Elysia): void {
  app.use(organizationDomainRoutes);
  app.use(tasksDomainRoutes);
  app.use(agentsDomainRoutes);
  app.use(aiDomainRoutes);
  app.use(schedulingDomainRoutes);
  app.use(learningDomainRoutes);
  app.use(systemDomainRoutes);
  app.use(workflowDomainRoutes);
  app.use(socialDomainRoutes);
  app.use(analyticsDomainRoutes);
  app.use(lifestyleDomainRoutes);
  app.use(memoryDomainRoutes);
  app.use(selfImprovementDomainRoutes);
  app.use(selfLearningDomainRoutes);
}
