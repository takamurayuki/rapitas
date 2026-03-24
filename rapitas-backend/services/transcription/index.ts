export { transcribeLocal, type LocalTranscriptionResult } from './whisper-local';
export {
  recordCorrection,
  applyCorrections,
  getCorrectionPatterns,
  deleteCorrection,
  getCorrectionStats,
  closeCorrectionDb,
  type CorrectionPattern,
} from './correction-learning';
