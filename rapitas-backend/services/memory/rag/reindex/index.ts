/**
 * reindex (barrel)
 *
 * Public surface of the embedding re-index batch: run / count / status /
 * enqueue helpers used by the memory system bootstrap and the operations API.
 */
export {
  runReindexBatch,
  countReindexPending,
  getEmbeddingIndexStatus,
  getReindexJob,
  enqueueReindex,
  maybeEnqueueReindex,
} from './reindex-batch';
export type { ReindexOptions, ReindexResult, EmbeddingIndexStatus } from './reindex-batch';
