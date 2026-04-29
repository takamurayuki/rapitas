import { classifyAgentError } from '../services/ai/agent-error-classifier';
const sample = `ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 1:19 PM.
2026-04-29T03:48:05.247433Z ERROR codex_core::session: failed to record rollout ...`;
console.log('No hint:', JSON.stringify(classifyAgentError(sample), null, 2));
console.log('With hint:', JSON.stringify(classifyAgentError(sample, 'openai'), null, 2));
