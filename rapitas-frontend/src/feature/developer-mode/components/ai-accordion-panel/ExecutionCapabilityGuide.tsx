'use client';

/**
 * ExecutionCapabilityGuide
 *
 * Renders an inline setup-required panel inside the AI agent execution
 * accordion when the task cannot actually run an agent (no theme, no
 * workingDirectory, no API key). Each state surfaces a direct link to the
 * setting the user needs to flip.
 */

import Link from 'next/link';
import { FolderTree, FolderCog, TerminalSquare, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Capability state derived from task + CLI availability. */
export type ExecutionCapability =
  | 'ready'
  | 'no-theme'
  | 'no-working-directory'
  | 'no-cli-available';

/** Shape returned by `GET /agent-availability?cliOnly=1`. */
export interface CliAvailability {
  fetchedAt: string;
  cliOnly: boolean;
  providers: Array<{
    provider: string;
    available: boolean;
    reason: string | null;
    modelCount: number;
  }>;
}

interface ExecutionCapabilityGuideProps {
  capability: Exclude<ExecutionCapability, 'ready'>;
  /** Theme ID for deep-linking to the specific theme edit screen, if any. */
  themeId?: number | null;
}

/** Copy + icon + setup link for a non-ready capability state. */
function guideContent(
  capability: Exclude<ExecutionCapability, 'ready'>,
  t: ReturnType<typeof useTranslations>,
  themeId?: number | null,
): {
  icon: typeof FolderTree;
  title: string;
  body: string;
  href: string;
  cta: string;
} {
  switch (capability) {
    case 'no-theme':
      return {
        icon: FolderTree,
        title: t('noThemeTitle'),
        body: t('noThemeBody'),
        href: '/themes',
        cta: t('noThemeCta'),
      };
    case 'no-working-directory':
      return {
        icon: FolderCog,
        title: t('noWorkingDirTitle'),
        body: t('noWorkingDirBody'),
        href: themeId ? `/themes?edit=${themeId}` : '/themes',
        cta: t('noWorkingDirCta'),
      };
    case 'no-cli-available':
      return {
        icon: TerminalSquare,
        title: t('noCliTitle'),
        body: t('noCliBody'),
        href: '/setup',
        cta: t('noCliCta'),
      };
  }
}

/**
 * Inline guide panel rendered in place of the execution body when the task
 * is not yet able to run an agent.
 */
export function ExecutionCapabilityGuide({ capability, themeId }: ExecutionCapabilityGuideProps) {
  const t = useTranslations('devMode.executionCapabilityGuide');
  const { icon: Icon, title, body, href, cta } = guideContent(capability, t, themeId);

  return (
    <div
      role="status"
      aria-live="polite"
      data-capability={capability}
      className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{title}</p>
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{body}</p>
        </div>
      </div>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {cta}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
