'use client';

/**
 * BriefingPlayer
 *
 * Shows the night-run audio briefing of a report day: audio player (when
 * audio exists) and the full script text. The body is fetched only here, at
 * view time, through the token-protected /growth/briefing endpoints.
 */

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

const TOKEN_KEY = 'rapitas.briefingToken';

interface StoredBriefing {
  text: string;
  estimatedSeconds: number;
  hasAudio: boolean;
  audioSeconds?: number;
}

interface Props {
  date: string;
}

export default function BriefingPlayer({ date }: Props) {
  const [token, setToken] = useState('');
  const [draft, setDraft] = useState('');
  const [briefing, setBriefing] = useState<StoredBriefing | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY) ?? '');
  }, []);

  useEffect(() => {
    setBriefing(null);
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/growth/briefing/${date}/script?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok || cancelled) return;
        setBriefing((await res.json()) as StoredBriefing);
      } catch {
        // Briefing is optional; the text report below remains the source of truth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, token]);

  if (!token) {
    return (
      <form
        className="mb-4 flex items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          window.localStorage.setItem(TOKEN_KEY, draft);
          setToken(draft);
        }}
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ブリーフィング用トークン"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          設定
        </button>
      </form>
    );
  }
  if (!briefing) return null;

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        音声ブリーフィング（約{Math.ceil(briefing.audioSeconds ?? briefing.estimatedSeconds)}秒）
      </div>
      {briefing.hasAudio && briefing.audioSeconds != null && (
        <audio
          controls
          className="mb-2 w-full"
          src={`${API_BASE_URL}/growth/briefing/${date}/audio?token=${encodeURIComponent(token)}`}
        />
      )}
      <pre className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
        {briefing.text}
      </pre>
    </div>
  );
}
