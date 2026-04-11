/**
 * Learning Engine
 *
 * Public re-export surface for the self-learning subsystem.
 * Implementation is split across focused sub-modules for size compliance:
 *   - pattern-ops.ts  — createPattern, listPatterns, analyzeFailure, extractStrategy
 *   - prompt-ops.ts   — recordPromptEvolution, getPromptEvolutionHistory
 *   - stats-ops.ts    — getLearningStats, getGrowthTimeline, getMemoryOverview
 */

export { analyzeFailure, extractStrategy, createPattern, listPatterns } from './pattern-ops';

export { recordPromptEvolution, getPromptEvolutionHistory } from './prompt-ops';

export { getLearningStats, getGrowthTimeline, getMemoryOverview } from './stats-ops';
