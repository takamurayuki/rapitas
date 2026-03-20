/**
 * AgentExecutionPanel (re-export shim)
 *
 * Backward-compatibility re-export. The implementation has been split into
 * smaller files under ./agent-execution/. Import from there for new code.
 */

// NOTE: This shim exists so that existing imports of
// '@/feature/developer-mode/components/AgentExecutionPanel' continue to work
// without modification after the component split.
export { AgentExecutionPanel } from './agent-execution/AgentExecutionPanel';
export type { Props } from './agent-execution/AgentExecutionPanel';
