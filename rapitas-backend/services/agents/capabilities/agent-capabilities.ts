/**
 * Agent Capabilities Registry
 *
 * Single source of truth for what each agent type can / cannot do reliably.
 * Used by role-recommender to pick the best agent for each workflow phase
 * when no explicit WorkflowRoleConfig assignment exists.
 *
 * Design principle: the registry encodes empirical observations of how each
 * CLI/API agent behaves in production. It is updated when behavior shifts
 * (e.g. a CLI version starts respecting strict instructions, or stops).
 */

export type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';

export type AgentType =
  | 'codex'
  | 'claude-code'
  | 'gemini'
  | 'anthropic-api'
  | 'openai-api'
  | 'ollama';

export interface AgentCapability {
  /** Agent type identifier (matches `AIAgentConfig.agentType`). / エージェント種別 */
  type: AgentType;

  /**
   * Whether the agent reliably stops when told to ("save plan.md and exit
   * without modifying code"). codex CLI ignores such meta-instructions and
   * runs to implementation regardless — this flag is FALSE for it.
   */
  followsStrictInstructions: boolean;

  /**
   * Whether the agent naturally produces well-formed Markdown artifacts when
   * asked. CLI agents that prefer code edits (codex) score lower.
   */
  reliableMarkdownOutput: boolean;

  /** Strong implementation/coding ability. */
  goodForImplementation: boolean;

  /** Tends to produce thorough, multi-section research / plan documents. */
  goodForPlanning: boolean;

  /** Effective at critical review (finding flaws, asking questions). */
  goodForReview: boolean;

  /** Sandbox primitive: can be locked to read-only at OS level. */
  supportsReadOnlySandbox: boolean;

  /**
   * Roles for which this agent type is a NATURAL FIT. The role recommender
   * picks the highest-priority match from the user's available agents.
   */
  bestForRoles: WorkflowRole[];

  /**
   * Roles for which this agent type is KNOWN TO MISBEHAVE. The recommender
   * avoids assigning these unless there's no better choice.
   */
  avoidForRoles: WorkflowRole[];

  /** Free-form note for operators / logs. */
  notes: string;
}

/**
 * Registry of agent capabilities. Keyed by `AIAgentConfig.agentType`.
 * Update when CLI behavior changes — e.g. when a new codex version starts
 * respecting strict instructions, set followsStrictInstructions=true.
 */
export const AGENT_CAPABILITIES: Readonly<Record<AgentType, AgentCapability>> = Object.freeze({
  codex: {
    type: 'codex',
    followsStrictInstructions: false,
    reliableMarkdownOutput: false,
    goodForImplementation: true,
    goodForPlanning: true, // safe via investigationMode (read-only + -o)
    goodForReview: true, // safe via investigationMode
    supportsReadOnlySandbox: true,
    // Codex can run as researcher/planner/reviewer ONLY when wrapped in
    // investigationMode (--sandbox=read-only --ask-for-approval=never -o).
    // workflow-cli-executor enables this automatically for non-impl phases.
    bestForRoles: ['implementer', 'researcher', 'planner', 'reviewer'],
    avoidForRoles: [],
    notes:
      'Optimized for direct code implementation. For research/plan/review phases, MUST be wrapped in investigationMode (--sandbox=read-only --ask-for-approval=never -o file.md) so it cannot modify code at the OS level. Otherwise prefers claude-code or API agents.',
  },
  'claude-code': {
    type: 'claude-code',
    followsStrictInstructions: true,
    reliableMarkdownOutput: true,
    goodForImplementation: true,
    goodForPlanning: true,
    goodForReview: true,
    supportsReadOnlySandbox: true,
    bestForRoles: ['researcher', 'planner', 'reviewer', 'implementer', 'verifier'],
    avoidForRoles: [],
    notes:
      'Generalist agent. Respects role-scoped prompts and produces clean markdown artifacts. Good fit for any phase.',
  },
  gemini: {
    type: 'gemini',
    followsStrictInstructions: true,
    reliableMarkdownOutput: true,
    goodForImplementation: true,
    goodForPlanning: true,
    goodForReview: true,
    supportsReadOnlySandbox: true,
    bestForRoles: ['researcher', 'planner', 'reviewer', 'verifier'],
    avoidForRoles: [],
    notes:
      'Strong at analytical tasks (research, planning, review). Good markdown output. Slightly less consistent for raw code implementation than codex.',
  },
  'anthropic-api': {
    type: 'anthropic-api',
    followsStrictInstructions: true,
    reliableMarkdownOutput: true,
    goodForImplementation: false,
    goodForPlanning: true,
    goodForReview: true,
    supportsReadOnlySandbox: true,
    bestForRoles: ['researcher', 'planner', 'reviewer'],
    avoidForRoles: ['implementer', 'verifier'],
    notes:
      'Direct API call from server, no CLI. Cannot edit files / run commands. Best for non-impl phases where we want pure markdown output.',
  },
  'openai-api': {
    type: 'openai-api',
    followsStrictInstructions: true,
    reliableMarkdownOutput: true,
    goodForImplementation: false,
    goodForPlanning: true,
    goodForReview: true,
    supportsReadOnlySandbox: true,
    bestForRoles: ['researcher', 'planner', 'reviewer'],
    avoidForRoles: ['implementer', 'verifier'],
    notes:
      'Direct API call from server, no CLI. Cannot edit files. Best for research/plan/review phases.',
  },
  ollama: {
    type: 'ollama',
    followsStrictInstructions: true,
    reliableMarkdownOutput: true,
    goodForImplementation: false,
    goodForPlanning: false,
    goodForReview: false,
    supportsReadOnlySandbox: true,
    bestForRoles: [],
    avoidForRoles: ['implementer', 'planner', 'reviewer'],
    notes:
      'Local LLM, fast but lower quality output for complex reasoning. Suitable for short-form classification tasks (branch-name generation, complexity scoring), NOT for full role responsibilities.',
  },
});

/**
 * Quick capability lookup. Falls back to a conservative default when the
 * agent type is unknown so the recommender does not crash.
 *
 * @param agentType - Agent type from AIAgentConfig.agentType / エージェント種別
 * @returns Capability descriptor / 能力記述子
 */
export function getCapability(agentType: string): AgentCapability {
  return (
    AGENT_CAPABILITIES[agentType as AgentType] || {
      type: agentType as AgentType,
      followsStrictInstructions: false,
      reliableMarkdownOutput: false,
      goodForImplementation: false,
      goodForPlanning: false,
      goodForReview: false,
      supportsReadOnlySandbox: false,
      bestForRoles: [],
      avoidForRoles: ['researcher', 'planner', 'reviewer', 'implementer', 'verifier'],
      notes: 'Unknown agent type — capabilities undefined.',
    }
  );
}

/**
 * Score how well an agent fits a given role. Higher is better.
 * Range: -100 (avoid) to +100 (perfect fit).
 */
export function scoreAgentForRole(agentType: string, role: WorkflowRole): number {
  const cap = getCapability(agentType);
  if (cap.avoidForRoles.includes(role)) return -100;
  if (!cap.bestForRoles.includes(role)) return 0;

  let score = 50; // baseline for "best fit"
  if (role === 'implementer') {
    if (cap.goodForImplementation) score += 30;
    if (!cap.followsStrictInstructions) score += 10; // implementers benefit from drive
  } else if (role === 'researcher' || role === 'planner') {
    if (cap.goodForPlanning) score += 25;
    if (cap.reliableMarkdownOutput) score += 15;
    if (cap.followsStrictInstructions) score += 10;
    // Penalty for agents that need investigationMode wrapping — they CAN do
    // the role but only with extra sandbox configuration. Prefer agents that
    // do it natively.
    if (!cap.followsStrictInstructions) score -= 25;
    if (!cap.reliableMarkdownOutput) score -= 15;
  } else if (role === 'reviewer') {
    if (cap.goodForReview) score += 25;
    if (cap.followsStrictInstructions) score += 10;
    if (!cap.followsStrictInstructions) score -= 25;
  } else if (role === 'verifier' || role === 'auto_verifier') {
    if (cap.goodForImplementation) score += 15; // verifiers run tests
    if (cap.followsStrictInstructions) score += 10;
    if (cap.reliableMarkdownOutput) score += 10;
  }
  return score;
}
