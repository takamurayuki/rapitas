export {
  getLocalLLMStatus,
  ensureLocalLLM,
  stopLlamaServer,
  cleanupLocalLLM,
  type LocalLLMStatus,
} from './local-llm-manager';

export {
  downloadModel,
  downloadLlamaServer,
  deleteModel,
  getDownloadProgress,
  isModelDownloaded,
  isLlamaServerDownloaded,
  getModelPath,
  getLlamaServerPath,
  getModelsDir,
  getBinDir,
  type DownloadProgress,
} from './model-downloader';

export { sendRAGEnhancedMessage, type RAGEnhancedOptions } from './rag-enhanced-caller';

export {
  generateTeachingMaterial,
  evaluateStudentOutput,
  executeWithTeacherStudent,
  getTeachingStats,
  type EvaluationResult,
  type TeachingMaterial,
} from './teacher-student';

export {
  assessComplexity,
  type ComplexityLevel,
  type ComplexityAssessment,
} from './complexity-assessor';

export {
  delegateToLocalLLM,
  getAvailableDelegationTasks,
  type DelegationTaskType,
  type DelegationRequest,
  type DelegationResult,
} from './mcp-delegation-tool';

export {
  generateCacheKey,
  getCachedResponse,
  setCachedResponse,
  getCacheStats,
  purgeExpiredEntries,
  clearCache,
  closeCacheDb,
  type CacheStats,
} from './response-cache';
