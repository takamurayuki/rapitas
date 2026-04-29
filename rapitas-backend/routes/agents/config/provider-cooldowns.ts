/**
 * Provider Cooldowns Route
 *
 * Surface and manage the in-process cooldown registry. The orchestrator
 * places providers into cooldown automatically when a quota / rate-limit
 * / auth error is detected; this route lets the UI display the current
 * state and lets the user clear it manually after re-authenticating.
 */
import { Elysia, t } from 'elysia';
import {
  clearCooldown,
  listActiveCooldowns,
  type Provider,
} from '../../../services/ai/provider-cooldown';

export const providerCooldownsRoutes = new Elysia()
  .get('/agents/cooldowns', () => ({
    cooldowns: listActiveCooldowns().map((c) => ({
      provider: c.provider,
      reason: c.reason,
      until: new Date(c.until).toISOString(),
      model: c.model ?? null,
      message: c.message ?? null,
    })),
  }))
  .delete(
    '/agents/cooldowns/:provider',
    ({ params }) => {
      clearCooldown(params.provider as Provider);
      return { success: true };
    },
    {
      params: t.Object({ provider: t.String() }),
    },
  );
