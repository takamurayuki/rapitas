'use client';
/**
 * useEmbedCheck
 *
 * Ask the backend whether a page would render in the web app's iframe
 * (`POST /url-embed-check`) before building one. Results are kept per URL for
 * the session. A failed request counts as `unknown`: the frame is still
 * built, with the "open externally" rescue visible.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type EmbedVerdict = 'embeddable' | 'refused' | 'unknown';

const verdicts = new Map<string, EmbedVerdict>();

/**
 * Fetch the verdict for one URL from the backend.
 *
 * @param url - The page to check / 判定する URL
 * @returns The backend's verdict, or unknown on any failure / 判定
 */
export async function fetchEmbedVerdict(url: string): Promise<EmbedVerdict> {
  try {
    const res = await fetch(`${API_BASE_URL}/url-embed-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, origin: window.location.origin }),
    });
    if (!res.ok) return 'unknown';
    const json = (await res.json()) as { result?: unknown };
    return json.result === 'embeddable' || json.result === 'refused' ? json.result : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The verdicts for a set of URLs, fetched once each.
 *
 * @param urls - The URLs the open tabs point at / 各タブの URL
 * @returns url → verdict; a URL still being checked is absent / 判定の対応表
 */
export function useEmbedVerdicts(urls: string[]): Record<string, EmbedVerdict> {
  const [known, setKnown] = useState<Record<string, EmbedVerdict>>(() =>
    Object.fromEntries(urls.filter((u) => verdicts.has(u)).map((u) => [u, verdicts.get(u)!])),
  );
  const key = urls.join('\n');

  useEffect(() => {
    let cancelled = false;
    for (const url of new Set(urls)) {
      const cached = verdicts.get(url);
      if (cached) {
        setKnown((k) => (k[url] === cached ? k : { ...k, [url]: cached }));
        continue;
      }
      void fetchEmbedVerdict(url).then((verdict) => {
        verdicts.set(url, verdict);
        if (!cancelled) setKnown((k) => ({ ...k, [url]: verdict }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return known;
}

/** Forget every verdict. Exported for tests only. */
export function resetEmbedVerdicts(): void {
  verdicts.clear();
}
