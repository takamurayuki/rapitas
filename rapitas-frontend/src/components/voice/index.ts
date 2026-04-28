/**
 * Voice Input Components
 *
 * Global voice input system: floating bar + inline mic buttons + provider context.
 */
export { default as VoiceInputProvider, useVoiceInput } from './VoiceInputProvider';
export { default as VoiceInputBar } from './VoiceInputBar';
export { default as InlineMicButton } from './InlineMicButton';
export { default as WakeWordDetector } from './WakeWordDetector';
export type { VoiceTarget } from './VoiceInputBar';
