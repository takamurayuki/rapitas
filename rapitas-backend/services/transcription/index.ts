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
export {
  transcribeFast,
  ensureDaemon,
  stopDaemon,
  isDaemonReady,
} from './whisper-daemon-service';
export {
  parseVoiceCommand,
  type VoiceCommand,
} from './voice-command-parser';
