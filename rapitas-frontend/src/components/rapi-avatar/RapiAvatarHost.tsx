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
import { useCallback, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useResumableExecutions } from '@/components/resumable-executions/useResumableExecutions';
import { RapiAvatarDock } from './avatar/RapiAvatarDock';
import { RapiAvatarPanel } from './panel/RapiAvatarPanel';
import { placePanel, useRapiDrag } from './avatar/drag';
import { useRapiAvatarState } from './state/useRapiAvatarState';
import { isAppShellHidden } from '@/utils/app-shell';

/**
 * How wide the panel is on a window with room for it.
 *
 * 448, up from 320: at 320 the box was too cramped to write a request in
 * (reported 2026-11-14). Narrowed to the window by `placePanel`. Where it
 * sits — above her by default, 12px clear so the tail touches her head — is
 * worked out there too, from wherever she has been carried.
 */
const PANEL_WIDTH_PX = 448;

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
  const drag = useRapiDrag();
  const placement = useMemo(
    () => placePanel(drag.position, drag.viewport, PANEL_WIDTH_PX),
    [drag.position, drag.viewport],
  );

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
          placement={placement}
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
        drag={drag}
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
