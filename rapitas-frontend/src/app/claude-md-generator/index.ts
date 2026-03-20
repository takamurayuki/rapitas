/**
 * index
 *
 * Barrel export for the claude-md-generator module.
 * Import from this file to access all public types, constants, and components
 * without coupling consumers to internal file locations.
 */

export type { AppAnswers, AppProposal, DynamicItem, GenerateResult } from './types';
export { GENRES, SUB_GENRES, ELEMENTS, PLATFORMS, SCALES, PRIORITIES } from './constants';
export { GLOBAL_CSS } from './styles';
export { resolveLabels, proposeApps, generateClaudeMd, fetchSuggestions } from './api';
export { useWizard } from './use-wizard';
export type { WizardPhase, SetupPhase } from './use-wizard';
export { CheckIcon, DotIcon } from './icons';
export { ScoreRing } from './score-ring';
export { PageWrap } from './page-wrap';
export { IntroPhase } from './intro-phase';
export { GenrePhase } from './genre-phase';
export { SubPhase } from './sub-phase';
export { ElementsPhase } from './elements-phase';
export { PlatformPhase } from './platform-phase';
export { LoadingPhase } from './loading-phase';
export { ProposalsPhase } from './proposals-phase';
export { ResultPhase } from './result-phase';
