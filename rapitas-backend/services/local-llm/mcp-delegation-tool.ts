/**
 * MCP Delegation Tool for Local LLM
 *
 * Provides a tool definition that agents (Claude Code, etc.) can call to delegate
 * simple sub-tasks to the local LLM instead of consuming their own tokens.
 * The tool handles: summarization, commit message generation, code formatting,
 * translation, and other routine text transformations.
 *
 * Exposed as an HTTP endpoint that the agent can call via curl during execution.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { executeWithTeacherStudent } from './teacher-student';
import { createLogger } from '../../config';

const log = createLogger('local-llm:mcp-delegation');

/** Supported delegation task types and their configurations. */
const DELEGATION_TASKS = {
  summarize: {
    systemPrompt: `You are a concise summarizer. Summarize the given text in 2-3 sentences.
Output ONLY the summary, nothing else. If the input is in Japanese, respond in Japanese.`,
    expectedFormat: 'A 2-3 sentence summary of the input text',
    maxTokens: 256,
  },
  'commit-message': {
    systemPrompt: `You are a Git commit message generator. Generate a conventional commit message from the given diff or change description.

Format: <type>(<scope>): <description under 50 chars>

Types: feat, fix, docs, style, refactor, test, chore
Rules:
- English only, imperative mood
- Under 50 characters for the subject line
- Output ONLY the commit message, nothing else`,
    expectedFormat: 'A conventional commit message like "feat(auth): add login endpoint"',
    maxTokens: 100,
  },
  'branch-name': {
    systemPrompt: `You are a Git branch name generator. Output ONLY a branch name, nothing else.
Rules:
- Prefix: feature/, bugfix/, chore/, refactor/, docs/
- English only, lowercase kebab-case
- 2-5 words after prefix
- Max 50 characters
- If input is Japanese, translate to English`,
    expectedFormat: 'A branch name like "feature/add-user-auth"',
    maxTokens: 50,
  },
  translate: {
    systemPrompt: `You are a translator. Translate the given text between Japanese and English.
If the input is Japanese, translate to English. If English, translate to Japanese.
Output ONLY the translation, nothing else.`,
    expectedFormat: 'Translated text in the target language',
    maxTokens: 1024,
  },
  'extract-keywords': {
    systemPrompt: `Extract 3-5 keywords from the given text. Output as a comma-separated list.
If the input is Japanese, extract Japanese keywords.
Output ONLY the keywords, nothing else.`,
    expectedFormat: 'Comma-separated keywords like "authentication, login, JWT, session"',
    maxTokens: 100,
  },
  'format-code-comment': {
    systemPrompt: `Generate a JSDoc or brief code comment for the given code snippet.
Follow these rules:
- One sentence describing purpose (not implementation)
- Include @param and @returns if applicable
- English for doc comment, Japanese description in parentheses after each param/returns
- Output ONLY the comment block, nothing else`,
    expectedFormat: 'A JSDoc comment block',
    maxTokens: 256,
  },
  'classify-task': {
    systemPrompt: `Classify the given task description into one of these categories:
- feature: New functionality
- bugfix: Bug fix
- refactor: Code improvement without behavior change
- docs: Documentation only
- test: Test addition/modification
- chore: Maintenance, dependencies, config

Output ONLY the category name, nothing else.`,
    expectedFormat: 'A single category name like "feature" or "bugfix"',
    maxTokens: 20,
  },
} as const;

/** Valid delegation task type names. */
export type DelegationTaskType = keyof typeof DELEGATION_TASKS;

/** Request to delegate a sub-task to the local LLM. */
export interface DelegationRequest {
  taskType: DelegationTaskType;
  input: string;
  /** Use Teacher-Student evaluation loop. Defaults to false for speed. */
  evaluate?: boolean;
  /** Theme ID for RAG context scoping. */
  themeId?: number;
}

/** Result of a delegated sub-task. */
export interface DelegationResult {
  output: string;
  source: 'local-llm' | 'teacher-corrected' | 'escalated' | 'cached';
  taskType: DelegationTaskType;
  score?: number;
  processingTimeMs: number;
}

/**
 * Delegate a sub-task to the local LLM.
 *
 * This is the primary function agents call to offload routine work.
 * Supports optional Teacher-Student evaluation for quality assurance.
 *
 * @param request - Delegation request with task type and input. / 委譲リクエスト
 * @returns Delegation result with output and metadata. / 委譲結果
 */
export async function delegateToLocalLLM(request: DelegationRequest): Promise<DelegationResult> {
  const startTime = Date.now();
  const taskConfig = DELEGATION_TASKS[request.taskType];

  if (!taskConfig) {
    throw new Error(`Unknown delegation task type: ${request.taskType}`);
  }

  log.info(
    { taskType: request.taskType, inputLength: request.input.length },
    'Delegating to local LLM',
  );

  try {
    if (request.evaluate) {
      // Full Teacher-Student loop with evaluation
      const result = await executeWithTeacherStudent(
        request.taskType,
        taskConfig.systemPrompt,
        request.input,
        taskConfig.expectedFormat,
        { ragThemeId: request.themeId },
      );

      return {
        output: result.output,
        source: result.source === 'student' ? 'local-llm' : result.source,
        taskType: request.taskType,
        score: result.score,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Direct local LLM call with RAG (no evaluation, faster)
    const response = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: request.input }],
      systemPrompt: taskConfig.systemPrompt,
      maxTokens: taskConfig.maxTokens,
      enableRAG: true,
      ragThemeId: request.themeId,
    });

    return {
      output: response.content,
      source: 'local-llm',
      taskType: request.taskType,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    log.error({ err: error, taskType: request.taskType }, 'Delegation failed');
    throw error;
  }
}

/**
 * Get the list of available delegation task types and their descriptions.
 *
 * Used by agents to discover what tasks they can delegate.
 *
 * @returns Available task types with descriptions. / 利用可能なタスクタイプと説明
 */
export function getAvailableDelegationTasks(): Array<{
  type: DelegationTaskType;
  description: string;
  maxTokens: number;
}> {
  return Object.entries(DELEGATION_TASKS).map(([type, config]) => ({
    type: type as DelegationTaskType,
    description: config.expectedFormat,
    maxTokens: config.maxTokens,
  }));
}
