'use client';
/**
 * RapiFloatBridge
 *
 * The main window's half of ラピ on the desktop, where she is drawn in a
 * window of her own laid over this one (#1535).
 *
 * Tells her window where the app is and which theme it shows, opens in-app
 * links she was asked to follow, and decides when she may be shown: never
 * on the pages without the app shell, and not while one of this window's
 * overlays (a dialog, a menu, the unpinned side nav) is open — those are
 * drawn here, under her window, and she would sit on top of them.
 *
 * "Not shown" is said in the location rather than by hiding her window:
 * showing a window again takes the keyboard from this one, which would
 * happen every time a dialog closed.
 *
 * Draws nothing. Not responsible for her window's position or click-through
 * — `rapi_float.rs` owns both.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isAppShellHidden } from '@/utils/app-shell';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';
import {
  HELLO_EVENT,
  LOCATION_EVENT,
  NAVIGATE_EVENT,
  RAPI_FLOAT_LABEL,
  VISIBILITY_EVENT,
  type MainLocation,
} from './rapi-float-protocol';
import { onTauriEvent, sendToWindow } from './tauri-bus';

/**
 * Whether the page shows the dark theme.
 *
 * Read from the document rather than `useDarkMode`: each caller of that hook
 * holds its own copy of the theme, so only the class on `<html>` follows
 * every change.
 */
function useDocumentDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Bridges the main window to her window. Renders nothing. */
export function RapiFloatBridge() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const dark = useDocumentDark();
  const covered = useWebviewOcclusionStore((s) => s.occluders.length > 0);

  const location: MainLocation = {
    pathname: pathname ?? '/',
    panelParam: searchParams?.get('panel') ?? null,
    dark,
    shown: !isAppShellHidden(pathname) && !covered,
  };
  const latest = useRef(location);
  latest.current = location;
  const key = JSON.stringify(location);

  // A main window that has just loaded may be a new frontend; her window
  // checks for that on this, as it does each time it is shown.
  useEffect(() => {
    sendToWindow(RAPI_FLOAT_LABEL, VISIBILITY_EVENT, true);
  }, []);

  useEffect(() => {
    sendToWindow(RAPI_FLOAT_LABEL, LOCATION_EVENT, latest.current);
  }, [key]);

  // Through a ref: `useRouter` may hand back a new object on each render,
  // and re-subscribing on every render would drop events in between.
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    const offHello = onTauriEvent(HELLO_EVENT, () => {
      sendToWindow(RAPI_FLOAT_LABEL, LOCATION_EVENT, latest.current);
    });
    const offNavigate = onTauriEvent<string>(NAVIGATE_EVENT, (path) => {
      if (typeof path === 'string' && path.startsWith('/')) routerRef.current.push(path);
    });
    return () => {
      offHello();
      offNavigate();
    };
  }, []);

  return null;
}
