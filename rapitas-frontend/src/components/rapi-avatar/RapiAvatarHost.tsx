'use client';
/**
 * RapiAvatarHost
 *
 * Mounts the Rapi+ avatar once, in the app shell, so it is there on every
 * page and survives navigation.
 *
 * It joins what the avatar draws (`RapiAvatarDock`) to what rapitas is
 * doing (`useRapiAvatarState`) and to the theme, and owns one decision of
 * its own: what the bubble says.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDarkMode } from '@/hooks/useDarkMode';
import { RapiAvatarDock } from './RapiAvatarDock';
import { useCornerClearance } from './useCornerClearance';
import { useRapiAvatarState } from './useRapiAvatarState';

/** Where clicking the avatar goes: the page that shows what is running. */
const DETAIL_ROUTE = '/agents/execution-dashboard';

/** The resident avatar, bottom-right. */
export default function RapiAvatarHost() {
  const router = useRouter();
  const t = useTranslations('rapiAvatar');
  const { isDarkMode } = useDarkMode();
  const { state, agents } = useRapiAvatarState();
  // The resumable-executions banner claims the same corner, and does so
  // exactly while something is running — the avatar's busiest state.
  const liftPx = useCornerClearance();

  // Silent while idle — the bubble is for saying something, and the spec
  // keeps movement and speech for when something is actually happening.
  const message = state === 'idle' ? undefined : t(`message.${state}`, { count: agents });

  return (
    <RapiAvatarDock
      state={state}
      agents={agents}
      theme={isDarkMode ? 'dark' : 'light'}
      message={message}
      liftPx={liftPx}
      onClick={() => router.push(DETAIL_ROUTE)}
    />
  );
}
