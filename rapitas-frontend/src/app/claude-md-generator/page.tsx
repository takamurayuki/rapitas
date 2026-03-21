/**
 * ClaudeMdGeneratorPage
 *
 * Next.js page entry point for the CLAUDE.md generator wizard.
 * All state lives in useWizard; this file only wires phases to components.
 */

'use client';

import { useWizard } from './_hooks/useWizard';
import { IntroPhase } from './_components/intro-phase';
import { GenrePhase } from './_components/genre-phase';
import { SubPhase } from './_components/sub-phase';
import { ElementsPhase } from './_components/elements-phase';
import { PlatformPhase } from './_components/platform-phase';
import { LoadingPhase } from './_components/loading-phase';
import { ProposalsPhase } from './_components/proposals-phase';
import { ResultPhase } from './_components/result-phase';

export default function ClaudeMdGeneratorPage() {
  const w = useWizard();

  if (w.phase === 'intro')
    return (
      <IntroPhase
        topRef={w.topRef}
        t={w.t}
        onStart={() => w.setPhase('genre')}
      />
    );

  if (w.phase === 'genre')
    return (
      <GenrePhase
        topRef={w.topRef}
        t={w.t}
        onSelectGenre={w.handleSelectGenre}
      />
    );

  if (w.phase === 'sub')
    return (
      <SubPhase
        topRef={w.topRef}
        t={w.t}
        genre={w.answers.genre}
        selectedSubs={w.answers.subs || []}
        dynamicSubs={w.dynamicSubs}
        subsLoading={w.subsLoading}
        onToggle={w.toggleSub}
        onNext={w.handleSubNext}
        onBack={() => w.setPhase('genre')}
      />
    );

  if (w.phase === 'elements')
    return (
      <ElementsPhase
        topRef={w.topRef}
        t={w.t}
        selectedElements={w.answers.elements || []}
        dynamicElements={w.dynamicElements}
        elementsLoading={w.elementsLoading}
        onToggle={w.toggleElement}
        onNext={() => w.setPhase('platform')}
        onBack={() => w.setPhase('sub')}
      />
    );

  if (w.phase === 'platform')
    return (
      <PlatformPhase
        topRef={w.topRef}
        t={w.t}
        localPlatform={w.localPlatform}
        localScale={w.localScale}
        localPrio={w.localPrio}
        onSetPlatform={w.setLocalPlatform}
        onSetScale={w.setLocalScale}
        onSetPrio={w.setLocalPrio}
        onGenerate={w.handlePlatformGenerate}
        onBack={() => w.setPhase('elements')}
      />
    );

  if (w.phase === 'proposing')
    return (
      <LoadingPhase topRef={w.topRef} t={w.t} variant="proposing" />
    );

  if (w.phase === 'proposals')
    return (
      <ProposalsPhase
        topRef={w.topRef}
        t={w.t}
        proposals={w.proposals}
        aiErrorMessage={w.aiErrorMessage}
        pickedProp={w.pickedProp}
        onPick={w.setPickedProp}
        onRegenerate={w.handleRegenerateProposals}
        onGenerate={w.handleGenerateClaudeMd}
      />
    );

  if (w.phase === 'generating')
    return (
      <LoadingPhase topRef={w.topRef} t={w.t} variant="generating" />
    );

  if (w.phase === 'result')
    return (
      <ResultPhase
        topRef={w.topRef}
        t={w.t}
        pickedProp={w.pickedProp}
        result={w.result}
        copied={w.copied}
        setupPhase={w.setupPhase}
        createdThemePath={w.createdThemePath}
        setupError={w.setupError}
        onCopy={w.handleCopy}
        onRestart={w.handleRestart}
        onCreateTheme={w.handleCreateTheme}
        onResetSetup={() => {
          w.setSetupPhase('idle');
          w.setSetupError(null);
          w.setCreatedThemePath(null);
        }}
      />
    );

  return null;
}
