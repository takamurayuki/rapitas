/**
 * Workflow Roles Routes
 * AI agent role configuration for each workflow phase (research, plan, implement, verify)
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config';
import { formatAgentDisplayName } from '../../../utils/agent/agent-display-name';
import { WORKFLOW_ROLES } from '../../../services/workflow/workflow-types';
import { isWorkflowMode } from '../../../services/workflow/workflow-types.guards.generated';
import type { WorkflowRole } from '../../../services/workflow/workflow-types';
import { isWorkflowRole } from '../../../services/workflow/workflow-types.guards.generated';
import { HTTP_STATUS } from '../../../utils/common/http-status';

const VALID_ROLES = WORKFLOW_ROLES;

const DEFAULT_PROMPT_KEYS: Record<WorkflowRole, string> = {
  researcher: 'workflow_role_researcher',
  planner: 'workflow_role_planner',
  implementer: 'workflow_role_implementer',
  verifier: 'workflow_role_verifier',
  auto_verifier: 'workflow_role_auto_verifier',
};

/**
 * Initialize missing roles with default values.
 * NOTE: Stale rows for retired roles (e.g. 'reviewer', retired 2026-08) are
 * simply not in VALID_ROLES — they are left untouched in the DB and never
 * surfaced, so existing databases keep working without a migration.
 */
async function ensureRolesExist() {
  const existing = await prisma.workflowRoleConfig.findMany({
    select: { role: true },
  });
  const existingRoles = new Set(existing.map((r) => r.role));

  const missing = VALID_ROLES.filter((role) => !existingRoles.has(role));
  if (missing.length > 0) {
    await prisma.workflowRoleConfig.createMany({
      data: missing.map((role) => ({
        role,
        systemPromptKey: DEFAULT_PROMPT_KEYS[role],
        isEnabled: true,
        metadata: '{}',
      })),
    });
  }
}

export const workflowRolesRoutes = new Elysia()

  .get('/workflow-roles', async () => {
    await ensureRolesExist();

    const roles = await prisma.workflowRoleConfig.findMany({
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Ensure role ordering
    const roleOrder: WorkflowRole[] = [
      'researcher',
      'planner',
      'implementer',
      'verifier',
      'auto_verifier',
    ];
    const sorted = roleOrder.map((role) => roles.find((r) => r.role === role)).filter(Boolean);

    // Rewrite legacy `Development Agent (...)` names so the workflow UI
    // (toggle-row summary, dropdowns) shows friendly labels.
    return sorted.map((r) => {
      if (!r) return r;
      const ac = r.agentConfig;
      return {
        ...r,
        agentConfig: ac ? { ...ac, name: formatAgentDisplayName(ac.name, ac.agentType) } : ac,
      };
    });
  })

  .get('/workflow-roles/:role', async ({ params, set }) => {
    const role = params.role as string;
    if (!isWorkflowRole(role)) {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: `無効なロール: ${role}。有効なロール: ${VALID_ROLES.join(', ')}` };
    }

    await ensureRolesExist();

    const config = await prisma.workflowRoleConfig.findUnique({
      where: { role },
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
    });

    if (!config) {
      set.status = HTTP_STATUS.NOT_FOUND;
      return { error: 'ロール設定が見つかりません' };
    }

    return config;
  })

  .put(
    '/workflow-roles/:role',
    async ({ params, body, set }) => {
      const role = params.role as string;
      if (!isWorkflowRole(role)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: `無効なロール: ${role}` };
      }

      await ensureRolesExist();

      const {
        agentConfigId,
        modelId,
        systemPromptKey,
        isEnabled,
        metadata,
        preferredProviderOverride,
      } = body as {
        agentConfigId?: number | null;
        modelId?: string | null;
        systemPromptKey?: string | null;
        isEnabled?: boolean;
        metadata?: string;
        /** `claude` | `openai` | `gemini` | `ollama` | `cross-provider` | null */
        preferredProviderOverride?: string | null;
      };

      if (preferredProviderOverride !== undefined && preferredProviderOverride !== null) {
        const valid = ['claude', 'openai', 'gemini', 'ollama', 'cross-provider'];
        if (!valid.includes(preferredProviderOverride)) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return {
            error: `preferredProviderOverride must be one of ${valid.join(', ')} or null`,
          };
        }
      }

      // Check existence when agentConfigId is specified
      if (agentConfigId !== undefined && agentConfigId !== null) {
        const agent = await prisma.aIAgentConfig.findUnique({
          where: { id: agentConfigId },
        });
        if (!agent) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { error: `エージェントID ${agentConfigId} が見つかりません` };
        }
        if (!agent.isActive) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { error: `エージェント "${agent.name}" は無効化されています` };
        }
      }

      // Check existence when systemPromptKey is specified
      if (systemPromptKey !== undefined && systemPromptKey !== null) {
        const prompt = await prisma.systemPrompt.findUnique({
          where: { key: systemPromptKey },
        });
        if (!prompt) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { error: `システムプロンプト "${systemPromptKey}" が見つかりません` };
        }
      }

      const updateData: Record<string, unknown> = {};
      if (agentConfigId !== undefined) updateData.agentConfigId = agentConfigId;
      if (modelId !== undefined) updateData.modelId = modelId;
      if (systemPromptKey !== undefined) updateData.systemPromptKey = systemPromptKey;
      if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
      if (metadata !== undefined) updateData.metadata = metadata;
      if (preferredProviderOverride !== undefined) {
        updateData.preferredProviderOverride = preferredProviderOverride;
      }

      const updated = await prisma.workflowRoleConfig.update({
        where: { role },
        data: updateData,
        include: {
          agentConfig: {
            select: {
              id: true,
              agentType: true,
              name: true,
              modelId: true,
              isActive: true,
            },
          },
        },
      });

      return updated;
    },
    {
      params: t.Object({ role: t.String() }),
      body: t.Optional(
        t.Object(
          {
            agentConfigId: t.Optional(t.Union([t.Number(), t.Null()])),
            modelId: t.Optional(t.Union([t.String(), t.Null()])),
            systemPromptKey: t.Optional(t.Union([t.String(), t.Null()])),
            isEnabled: t.Optional(t.Boolean()),
            // Raw JSON string — previously unchecked; cap length to keep an
            // oversized payload from reaching the DB write.
            metadata: t.Optional(t.String({ maxLength: 20_000 })),
            preferredProviderOverride: t.Optional(t.Union([t.String(), t.Null()])),
          },
          { additionalProperties: false },
        ),
      ),
    },
  )

  // Reset all roles to defaults
  .post('/workflow-roles/initialize', async () => {
    await ensureRolesExist();

    const roles = await prisma.workflowRoleConfig.findMany({
      include: {
        agentConfig: {
          select: {
            id: true,
            agentType: true,
            name: true,
            modelId: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return { message: 'ロール初期化完了', roles };
  })

  /**
   * GET /workflow-modes — list the per-complexity-tier workflow mode settings
   * (lightweight/standard/comprehensive), including the derived phase sequence
   * for display. Seeds defaults on first read.
   */
  .get('/workflow-modes', async () => {
    const { getAllModeSettings, buildTransitions } =
      await import('../../../services/workflow/workflow-mode-config');
    const all = await getAllModeSettings();
    return {
      modes: Object.values(all).map((s) => ({
        ...s,
        // Ordered phase keys for UI preview (research/plan/implement/verify).
        phases: Object.values(buildTransitions(s)).map((t) => t.role),
      })),
    };
  })

  /**
   * PUT /workflow-modes/:mode — update one tier's phase toggles and complexity
   * range. Body: { includePlan?, autoVerify?, complexityMin?,
   * complexityMax?, isEnabled? }.
   */
  .put(
    '/workflow-modes/:mode',
    async ({ params, body, set }) => {
      const mode = params.mode as 'lightweight' | 'standard' | 'comprehensive';
      if (!isWorkflowMode(mode)) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { error: 'Invalid mode' };
      }
      const b = (body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of ['includePlan', 'autoVerify', 'isEnabled'] as const) {
        if (typeof b[k] === 'boolean') patch[k] = b[k];
      }
      for (const k of ['complexityMin', 'complexityMax'] as const) {
        if (typeof b[k] === 'number') patch[k] = b[k];
      }
      const { updateModeSettings } =
        await import('../../../services/workflow/workflow-mode-config');
      const updated = await updateModeSettings(mode, patch);
      return { success: true, mode: updated };
    },
    {
      params: t.Object({ mode: t.String() }),
      body: t.Optional(
        t.Object(
          {
            includePlan: t.Optional(t.Boolean()),
            autoVerify: t.Optional(t.Boolean()),
            complexityMin: t.Optional(t.Number()),
            complexityMax: t.Optional(t.Number()),
            isEnabled: t.Optional(t.Boolean()),
          },
          { additionalProperties: false },
        ),
      ),
    },
  );
