import { classifyAgentError } from '../services/ai/agent-error-classifier';

const codexErr = `ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 1:19 PM.`;
console.log(
  '1. Codex usage-limit (strict):',
  JSON.stringify(classifyAgentError(codexErr, { strict: true }), null, 2),
);

const claudeOk = `## Verification Report

Tests passed: 12/12. Implements rate limiting middleware as specified.
Credit goes to @ymd for the original idea.

PR created: https://github.com/owner/repo/pull/42`;
console.log('\n2. Claude success-output (strict):', classifyAgentError(claudeOk, { strict: true }));

const anthropicErr = `Anthropic API error: rate_limit_error`;
console.log(
  '\n3. Anthropic rate_limit_error (strict):',
  JSON.stringify(classifyAgentError(anthropicErr, { strict: true }), null, 2),
);
