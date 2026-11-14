'use client';
/**
 * RapiFloatPage
 *
 * ラピ's own window on the desktop (#1535): a transparent page the size of
 * the main window's client area, laid over it, with nothing on it but her.
 *
 * She is the same component the browser build mounts in the main window,
 * fed the main window's location and theme through `RapiEnvironmentProvider`
 * — so she looks and behaves as she did, only drawn above the header and the
 * in-app browser instead of under them.
 *
 * Not responsible for where the window is or which clicks reach it — the
 * Rust side (`rapi_float.rs`) owns both, from the rectangles reported here.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useStaleDocumentReload } from '@/app/pomodoro-float/_hooks/use-stale-document-reload';
import { RapiEnvironmentProvider } from './rapi-environment';
import {
  HELLO_EVENT,
  LOCATION_EVENT,
  NAVIGATE_EVENT,
  VISIBILITY_EVENT,
  inAppPath,
  type MainLocation,
} from './rapi-float-protocol';
import { useFloatHitRects } from './useFloatHitRects';
import { onTauriEvent, sendToWindow } from './tauri-bus';

/** Only the page itself is transparent; everything she draws keeps its own. */
function useTransparentPage(): void {
  useEffect(() => {
    const { documentElement: html, body } = document;
    html.style.setProperty('background', 'transparent');
    body.style.setProperty('background', 'transparent');
    return () => {
      html.style.removeProperty('background');
      body.style.removeProperty('background');
    };
  }, []);
}

/** The main window's location and theme, as it last sent them. */
function useMainLocation(): MainLocation | null {
  const [location, setLocation] = useState<MainLocation | null>(null);
  useEffect(() => {
    // The main window sends on change only and this page may load after it,
    // so it asks — once listening, or the answer could arrive to no one.
    return onTauriEvent<MainLocation>(LOCATION_EVENT, setLocation, () => {
      sendToWindow('main', HELLO_EVENT);
    });
  }, []);
  return location;
}

/** Follows the main window's theme, which this document cannot see. */
function useThemeClass(dark: boolean | undefined): void {
  useEffect(() => {
    if (dark === undefined) return;
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
  }, [dark]);
}

/**
 * Her links open tasks. Followed here they would load the app into this
 * transparent window, so in-app ones are handed to the main window instead.
 */
function useLinksOpenInMain(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest('a') : null;
      const path = inAppPath(anchor?.getAttribute('href') ?? null);
      if (!path) return;
      e.preventDefault();
      sendToWindow('main', NAVIGATE_EVENT, path);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

/**
 * The page of her window.
 *
 * @param props - She, as the host renders her / ラピ本体
 */
export function RapiFloatPage({ children }: { children: ReactNode }) {
  // This window is shown and hidden for the app's lifetime, so it outlives
  // frontend restarts the same way the Pomodoro window does.
  useStaleDocumentReload({ event: VISIBILITY_EVENT });
  useTransparentPage();
  const location = useMainLocation();
  const shown = location?.shown ?? false;
  useFloatHitRects(shown);
  useLinksOpenInMain();
  useThemeClass(location?.dark);

  // Nothing until the main window has spoken: drawn with a guessed theme
  // and no location, she would flash the wrong colours and offer nothing
  // about the task that is open.
  if (!location) return null;
  return (
    <RapiEnvironmentProvider value={{ ...location, floating: true }}>
      {/* Hidden, not unmounted: what was typed and any request in flight
          outlive a dialog opening in the main window. */}
      <div data-rapi-float-shown={shown} style={shown ? undefined : { visibility: 'hidden' }}>
        {children}
      </div>
    </RapiEnvironmentProvider>
  );
}
