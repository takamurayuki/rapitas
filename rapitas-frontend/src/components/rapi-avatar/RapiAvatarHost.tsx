'use client';
/**
 * RapiAvatarHost
 *
 * Mounts ラピ (Rapi) once, in the app shell, so it is there on every
 * page and survives navigation.
 *
 * It joins what the avatar draws to what rapitas is doing, to the theme,
 * and to the executions that can be resumed — which it owns so the hook
 * runs once. That hook used to belong to the resumable-executions banner,
 * a card parked in this same corner saying what the avatar says; the card
 * is gone and its contents open from the avatar instead.
 */
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useResumableExecutions } from '@/components/resumable-executions/useResumableExecutions';
import { RapiAvatarDock } from './RapiAvatarDock';
import { RapiAvatarPanel } from './RapiAvatarPanel';
import { useRapiAvatarState } from './useRapiAvatarState';

/** Where the panel sits: above the avatar, clear of it. */
const PANEL_BOTTOM_PX = 124;

/** The resident avatar, bottom-right. */
export default function RapiAvatarHost() {
  const t = useTranslations('rapiAvatar');
  const { isDarkMode } = useDarkMode();
  const [open, setOpen] = useState(false);

  const {
    executions,
    resumingIds,
    dismissingIds,
    runningCount,
    interruptedCount,
    handleResume,
    handleResumeAll,
    handleDismiss,
    formatTimeAgo,
  } = useResumableExecutions();

  const { state, agents } = useRapiAvatarState(interruptedCount);

  const close = useCallback(() => setOpen(false), []);

  // Silent while idle — the bubble is for saying something, and the spec
  // keeps movement and speech for when something is actually happening.
  const message = state === 'idle' ? undefined : t(`message.${state}`, { count: agents });

  return (
    <>
      {open && executions.length > 0 && (
        <RapiAvatarPanel
          executions={executions}
          resumingIds={resumingIds}
          dismissingIds={dismissingIds}
          runningCount={runningCount}
          interruptedCount={interruptedCount}
          onResume={handleResume}
          onResumeAll={handleResumeAll}
          onDismiss={handleDismiss}
          formatTimeAgo={formatTimeAgo}
          onClose={close}
          bottomPx={PANEL_BOTTOM_PX}
        />
      )}
      <RapiAvatarDock
        state={state}
        agents={agents}
        theme={isDarkMode ? 'dark' : 'light'}
        // The bubble steps aside while the panel is up; two things
        // speaking at once in one corner is what this change removed.
        message={open ? undefined : message}
        onClick={() => setOpen((prev) => !prev)}
      />
    </>
  );
}
