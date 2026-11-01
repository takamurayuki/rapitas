'use client';
/**
 * RapiAvatarHost
 *
 * Mounts ラピ (Rapi) once, in the app shell, so it is there on every
 * page and survives navigation.
 *
 * It joins what the avatar draws to what rapitas is doing, to the theme,
 * and to the executions that can be resumed — which it owns so the hook
 * runs once. The panel opens whenever ラピ is clicked — it holds the intake
 * as well as the executions, so there is always something there. That hook
 * used to belong to the resumable-executions banner,
 * a card parked in this same corner saying what the avatar says; the card
 * is gone and its contents open from the avatar instead.
 */
import { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useResumableExecutions } from '@/components/resumable-executions/useResumableExecutions';
import { RapiAvatarDock } from './RapiAvatarDock';
import { RapiAvatarPanel } from './RapiAvatarPanel';
import { useRapiAvatarState } from './useRapiAvatarState';
import { isAppShellHidden } from '@/utils/app-shell';

/**
 * Where the panel sits: just above ラピ's head.
 *
 * She occupies 20..88 from the bottom (`bottom: 20` plus the 68px drawing),
 * so 100 leaves her 12px of clearance and the bubble's 11px tail reaches
 * down to 89 — touching the top of her without covering her.
 */
const PANEL_BOTTOM_PX = 100;

/**
 * How far in from the panel's right edge ラピ's head is.
 *
 * Both sit at `right: 24`; the drawing is 68 wide, so her centre is 58 from
 * the viewport edge and 34 in from the panel's. The tail is aimed there.
 */
const PANEL_TAIL_OFFSET_PX = 34;

/** The resident avatar, bottom-right. Mounted only where she belongs. */
function RapiAvatarResident() {
  const t = useTranslations('rapiAvatar');
  const { isDarkMode } = useDarkMode();
  const [open, setOpen] = useState(false);

  /**
   * Whether she has ever been opened.
   *
   * The panel stays mounted once it has been, so closing it keeps what was
   * typed, which tab was chosen, and — the expensive part — any request
   * still in flight. A roadmap draft takes tens of seconds; unmounting on
   * close threw the answer away with no way back but asking again.
   *
   * Mounted lazily rather than always, because it opens on the survey and
   * that costs a request: mounting it up front would spend one on every page
   * load, before she has been asked for anything.
   */
  const [everOpened, setEverOpened] = useState(false);
  const toggle = useCallback(() => {
    setEverOpened(true);
    setOpen((prev) => !prev);
  }, []);

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
      {everOpened && (
        <RapiAvatarPanel
          open={open}
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
          tailOffsetPx={PANEL_TAIL_OFFSET_PX}
          dark={isDarkMode}
        />
      )}
      <RapiAvatarDock
        state={state}
        agents={agents}
        theme={isDarkMode ? 'dark' : 'light'}
        // The bubble steps aside while the panel is up; two things
        // speaking at once in one corner is what this change removed.
        message={open ? undefined : message}
        onClick={toggle}
      />
    </>
  );
}

/**
 * Keeps ラピ out of the pages that are not the app.
 *
 * A separate component rather than an early return inside the one above,
 * because the gate has to sit AHEAD of the hooks: `useResumableExecutions`
 * costs a request, and nothing she offers — resuming an execution, filing a
 * task, the survey — is reachable before signing in. Returning early inside
 * that component would also change its hook count when the route changes.
 */
export default function RapiAvatarHost() {
  const pathname = usePathname();
  if (isAppShellHidden(pathname)) {
    return null;
  }
  return <RapiAvatarResident />;
}
