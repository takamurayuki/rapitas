import { expect, mock, test } from 'bun:test';

const update = mock(async () => ({}));
mock.module('../../config', () => ({
  prisma: {
    workflowRoleConfig: {
      findFirst: async () => ({
        isEnabled: true,
        agentConfig: { id: 1, agentType: 'claude-code' },
      }),
    },
    aIAgentConfig: {
      findUnique: async () => ({
        id: 5,
        agentType: 'claude-code',
        name: 'Claude Code',
        modelId: null,
        apiKeyEncrypted: null,
        endpoint: null,
      }),
    },
    task: { update },
  },
}));
mock.module('./role-recommender', () => ({
  recommendAgentForRole: async () => ({ agentConfigId: 5 }),
}));
mock.module('../../config/logger', () => ({ createLogger: () => ({ info() {} }) }));
mock.module('./workflow-file-utils', () => ({
  resolveWorkflowDir: async () => ({ path: '/unused' }),
  readWorkflowFile: async () => '# Previously rejected but structurally valid plan',
}));
mock.module('./workflow-context-builder', () => ({
  applyPlanModeDirective: (_role: string, prompt: string) => prompt,
}));
mock.module('./phase-output-validator', () => ({ isReusableArtifact: () => true }));
mock.module('./workflow-orchestrator-prompt', () => ({
  resolveSystemPromptContent: async () => '',
}));

const { prepareAgentAndPrompt } = await import('./workflow-orchestrator-agent-prep');

test('planner selected by preflight still executes when a reusable old plan exists', async () => {
  const result = await prepareAgentAndPrompt(
    913,
    { role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' },
    'research_done',
  );
  expect(result.done).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

// NOTE: Manual per-role agent pins are no longer read (2026-11-20); the agent
// comes from the recommender over the auto-synced agent configs.
test('an agent pinned on the role is ignored in favour of the recommended agent', async () => {
  const result = await prepareAgentAndPrompt(
    914,
    { role: 'implementer', outputFile: 'verify', nextStatus: 'in_progress' } as never,
    'plan_approved',
  );
  if (result.done) throw new Error('unexpected early return');
  expect(result.agentConfig.id).toBe(5);
});
