'use client';
/**
 * rapi-environment
 *
 * What ラピ needs to know about the window she is helping with, wherever she
 * is drawn.
 *
 * In the browser she lives inside the main window's document, so its address
 * bar and its theme are hers. On the desktop she is drawn in a window of her
 * own laid over the main one (#1535), whose address is `/rapi-float` and
 * whose theme is whatever it was when it loaded — so there the main window's
 * location and theme are handed in through this context instead.
 *
 * Not responsible for getting them across windows — see `RapiFloatPage`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** Where the main window is, and how she is drawn. */
export interface RapiEnvironment {
  /** The main window's path. / メイン画面のパス */
  pathname: string | null;
  /** The main window's `?panel=` — the task open in the slide panel. / 開いているタスクパネル */
  panelParam: string | null;
  /** The main window's theme. / メイン画面のテーマ */
  dark: boolean;
  /**
   * True in her own window. Clicks elsewhere in the app never reach her
   * document there, so she learns of them as her window losing focus.
   * / 専用ウィンドウで描画中か
   */
  floating: boolean;
}

const RapiEnvironmentContext = createContext<RapiEnvironment | null>(null);

/**
 * Hand her the main window's state from outside it.
 *
 * @param props - The environment and what it applies to / 環境と子要素
 */
export function RapiEnvironmentProvider({
  value,
  children,
}: {
  value: RapiEnvironment;
  children: ReactNode;
}) {
  return (
    <RapiEnvironmentContext.Provider value={value}>{children}</RapiEnvironmentContext.Provider>
  );
}

/**
 * The main window's location, from the provider when there is one and from
 * this document's own address otherwise.
 *
 * @returns The path and the slide panel's task id / パスとパネルのタスクID
 */
export function useRapiLocation(): { pathname: string | null; panelParam: string | null } {
  const env = useContext(RapiEnvironmentContext);
  // Called unconditionally: hooks may not depend on whether a provider exists.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (env) return { pathname: env.pathname, panelParam: env.panelParam };
  return { pathname, panelParam: searchParams?.get('panel') ?? null };
}

/**
 * The provided environment, or null when she lives in the main document.
 *
 * @returns The environment / 環境（メイン画面内なら null）
 */
export function useRapiEnvironment(): RapiEnvironment | null {
  return useContext(RapiEnvironmentContext);
}
