/**
 * 自己学習型AIエージェント - エクスポート
 */

// Types
export type * from './types';

// Experiment Engine
export {
  createExperiment,
  updateExperiment,
  runResearch,
  getExperiment,
  listExperiments,
  getExperimentTimeline,
} from './experiment-engine';

// Hypothesis Manager
export {
  createHypothesis,
  updateHypothesisStatus,
  reviseHypothesis,
  getHypotheses,
  rankHypotheses,
} from './hypothesis';

// Critic System
export { performReview, getReviews, getAverageScores } from './critic';

// Learning Engine
export {
  analyzeFailure,
  extractStrategy,
  createPattern,
  listPatterns,
  recordPromptEvolution,
  getPromptEvolutionHistory,
  getLearningStats,
  getGrowthTimeline,
  getMemoryOverview,
} from './learning-engine';

// Knowledge Graph
export {
  addNode,
  listNodes,
  getNode,
  addEdge,
  findRelated,
  getSubgraph,
  mergeNodes,
  getGraphStats,
} from './knowledge-graph';

// Episode Memory
export {
  saveEpisode,
  findSimilarEpisodes,
  summarizeExperiment,
  getEpisodeStats,
} from './episode-memory';
