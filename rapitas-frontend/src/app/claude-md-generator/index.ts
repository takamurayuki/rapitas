/**
 * index
 *
 * Barrel export for the claude-md-generator module.
 * Import from this file to access all public types, constants, and components
 * without coupling consumers to internal file locations.
 */

export type { AppAnswers, AppProposal, DynamicItem, GenerateResult } from './_types/types';
export { GENRES, SUB_GENRES, ELEMENTS, PLATFORMS, SCALES, PRIORITIES } from './_utils/constants';
export { GLOBAL_CSS } from './_utils/styles';
export { resolveLabels, proposeApps, generateClaudeMd, fetchSuggestions } from './_utils/api';
export { useWizard } from './_hooks/useWizard';
export type { WizardPhase, SetupPhase } from './_hooks/useWizard';
export { CheckIcon, DotIcon } from './_components/icons';
export { ScoreRing } from './_components/score-ring';
export { PageWrap } from './_components/page-wrap';
export { IntroPhase } from './_components/intro-phase';
export { GenrePhase } from './_components/genre-phase';
export { SubPhase } from './_components/sub-phase';
export { ElementsPhase } from './_components/elements-phase';
export { PlatformPhase } from './_components/platform-phase';
export { LoadingPhase } from './_components/loading-phase';
export { ProposalsPhase } from './_components/proposals-phase';
export { ResultPhase } from './_components/result-phase';
