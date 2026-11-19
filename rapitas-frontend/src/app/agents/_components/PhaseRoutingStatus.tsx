'use client';

/**
 * PhaseRoutingStatus
 *
 * Read-only panel listing the providers the automatic phase configuration can
 * use on this host and why the others are out. Replaces the manual "default
 * agent" picker: there is nothing to choose — a provider joins the
 * configuration by becoming usable (CLI installed and logged in).
 */
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ClaudeIcon, ChatGPTIcon, GeminiIcon } from '@/components/icons/ProviderIcons';
import { API_BASE_URL } from '@/utils/api';

/** Response of `GET /workflow/phase-routing`. */
interface PhaseRoutingResponse {
  usable: string[];
  unavailable: Array<{ provider: string; reason: string; cooled: boolean }>;
}

/** Providers worth listing; Ollama never runs a phase, so it is left out. */
const LISTED: ReadonlyArray<{
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}> = [
  { key: 'claude', label: 'Claude', icon: ClaudeIcon, iconColor: 'text-orange-500' },
  { key: 'openai', label: 'OpenAI / Codex', icon: ChatGPTIcon, iconColor: 'text-emerald-500' },
  { key: 'gemini', label: 'Gemini', icon: GeminiIcon, iconColor: 'text-indigo-500' },
];

export function PhaseRoutingStatus() {
  const t = useTranslations('agents.phaseRouting');
  const [data, setData] = useState<PhaseRoutingResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/phase-routing`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PhaseRoutingResponse;
        if (alive) setData(body);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h2>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>

      {failed && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t('failed')}</p>}
      {!failed && !data && <p className="mt-3 text-xs text-zinc-500">{t('loading')}</p>}
      {data && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {LISTED.map(({ key, label, icon: Icon, iconColor }) => {
            const usable = data.usable.includes(key);
            const miss = data.unavailable.find((u) => u.provider === key);
            const state = usable ? 'usable' : miss?.cooled ? 'cooled' : 'unavailable';
            return (
              <li
                key={key}
                className={`rounded-lg border px-3 py-2 ${
                  usable
                    ? 'border-emerald-200 dark:border-emerald-800'
                    : 'border-zinc-200 dark:border-zinc-700 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                    {label}
                  </span>
                  <span
                    className={`text-[11px] ${
                      usable
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {t(state)}
                  </span>
                </div>
                {!usable && miss?.reason && (
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{miss.reason}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
