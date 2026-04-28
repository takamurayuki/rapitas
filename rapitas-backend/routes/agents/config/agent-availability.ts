/**
 * Agent Availability Route
 *
 * Exposes the model-discovery probe results so the UI can show the real
 * runtime state of each provider — not just whether an `AIAgentConfig` row
 * exists. Used by `/agents` page's GlobalProviderPreference to display
 * "✓ CLI 認証済み" / "⚠ CLI 応答なし" for each card.
 *
 * Sourced from `services/ai/model-discovery` which spawns CLI probes and
 * hits provider REST endpoints; results are cached there for 5 minutes so
 * polling this endpoint is cheap.
 */
import { Elysia, t } from 'elysia';
import {
  discoverModels,
  invalidateModelDiscoveryCache,
} from '../../../services/ai/model-discovery';

export const agentAvailabilityRoutes = new Elysia().get(
  '/agent-availability',
  async ({ query }) => {
    if (query.refresh === '1') invalidateModelDiscoveryCache();
    const cliOnly = query.cliOnly === '1';
    const result = await discoverModels(query.refresh === '1', { cliOnly });
    return {
      fetchedAt: result.fetchedAt,
      cliOnly,
      providers: result.providers.map((p) => ({
        provider: p.provider,
        available: p.available,
        reason: p.reason ?? null,
        modelCount: p.models.length,
        sampleModels: p.models.slice(0, 5).map((m) => ({
          id: m.id,
          tier: m.tier,
          source: m.source,
        })),
      })),
    };
  },
  {
    query: t.Object({
      refresh: t.Optional(t.String()),
      cliOnly: t.Optional(t.String()),
    }),
  },
);
