/**
 * phase-routing-routes
 *
 * Read-only view of how workflow phases are routed: the providers this host
 * can run, why the others are out, and the rule each role follows. There is
 * nothing to configure here — the configuration is built automatically from
 * the usable providers and the model tier table (phase-providers.ts).
 */
import { Elysia } from 'elysia';
import { WORKFLOW_ROLES, type WorkflowRole } from '../../../services/workflow/workflow-types';
import type { PhaseProviders } from '../../../services/workflow/phase-providers';

/** How each role picks its provider (mirrors role-provider-resolver.ts). */
export type PhaseRoleRule = 'follow_upstream' | 'different_from_upstream';

const REVIEW_ROLES: ReadonlySet<WorkflowRole> = new Set(['verifier', 'auto_verifier']);

/** Response of `GET /workflow/phase-routing`. */
export interface PhaseRoutingView {
  usable: PhaseProviders['usable'];
  unavailable: Array<{ provider: string; reason: string; cooled: boolean }>;
  roles: Array<{ role: WorkflowRole; rule: PhaseRoleRule; crossProviderActive: boolean }>;
}

/**
 * Build the read-only routing view from provider availability.
 *
 * @param phase - Usable and excluded providers / 使える・除外するプロバイダ
 * @returns The view returned to the UI / 画面向けの表示内容
 */
export function buildPhaseRoutingView(phase: PhaseProviders): PhaseRoutingView {
  return {
    usable: phase.usable,
    unavailable: phase.excluded.map((provider) => ({
      provider,
      reason: phase.reasons[provider] ?? '',
      cooled: phase.cooled.includes(provider),
    })),
    roles: WORKFLOW_ROLES.map((role) => {
      const review = REVIEW_ROLES.has(role);
      return {
        role,
        rule: review ? 'different_from_upstream' : 'follow_upstream',
        // A different provider can only be used when a second one is usable.
        crossProviderActive: review && phase.usable.length > 1,
      };
    }),
  };
}

const phaseRoutingRoutes = new Elysia({ prefix: '/workflow' }).get('/phase-routing', async () => {
  const { resolvePhaseProviders } = await import('../../../services/workflow/phase-providers');
  return buildPhaseRoutingView(await resolvePhaseProviders());
});

export default phaseRoutingRoutes;
