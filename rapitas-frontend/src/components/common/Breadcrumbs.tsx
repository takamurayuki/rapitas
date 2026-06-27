'use client';
/**
 * Breadcrumbs
 *
 * Shows the location trail for nested pages so users can see where they are and
 * jump back up the hierarchy. Renders only on genuinely nested routes (≥2 path
 * segments); top-level pages, auth, task detail, and the settings hub (which has
 * its own tab bar) are intentionally skipped.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { checkIsTaskDetailPage } from '@/components/header/types';

/** Human-readable label for each known route segment. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'ダッシュボード',
  notes: 'ノート',
  ideas: 'アイデア',
  concerns: '懸念',
  hypotheses: '仮説',
  backlog: 'バックログ',
  gantt: 'ガントチャート',
  categories: 'カテゴリ',
  themes: 'テーマ',
  labels: 'ラベル',
  calendar: 'カレンダー',
  habits: '習慣',
  'daily-schedule': 'デイリースケジュール',
  reports: '週次レポート',
  learning: '学習',
  'learning-goals': '学習目標',
  'exam-goals': '試験目標',
  github: 'GitHub',
  'pull-requests': 'Pull Requests',
  issues: 'Issues',
  actions: 'CI/CD',
  logs: 'ログ分析',
  agents: 'エージェント',
  metrics: 'メトリクス',
  memory: '記憶の可視化',
  knowledge: 'ナレッジ',
  contradictions: '矛盾',
  admin: '管理',
  'system-prompts': 'プロンプト管理',
  'claude-md-generator': 'CLAUDE.md生成',
};

// Group-only segments that have no page of their own, so their crumb is plain
// text (linking to them would 404).
const NON_NAVIGABLE_SEGMENTS = new Set(['habits', 'learning']);

/** Resolves a segment to its display label (numeric ids become "詳細"). */
function segmentLabel(segment: string): string {
  if (/^\d+$/.test(segment)) return '詳細';
  return SEGMENT_LABELS[segment] ?? segment;
}

/**
 * Renders the breadcrumb trail for the current nested route, or nothing when
 * breadcrumbs are not warranted (shallow / excluded routes).
 */
export function Breadcrumbs() {
  const pathname = usePathname() ?? '';
  const segments = pathname.split('/').filter(Boolean);

  // Skip where a trail adds no value or would clash with other chrome.
  if (
    segments.length < 2 ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/settings') ||
    checkIsTaskDetailPage(pathname)
  ) {
    return null;
  }

  return (
    <nav
      aria-label="パンくずリスト"
      className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-4 text-xs text-zinc-400 dark:text-zinc-500"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link
            href="/"
            className="rounded transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            ホーム
          </Link>
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const navigable =
            !isLast && !NON_NAVIGABLE_SEGMENTS.has(segment) && !/^\d+$/.test(segment);
          const label = segmentLabel(segment);
          return (
            <li key={href} className="flex items-center gap-1.5">
              <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
                ›
              </span>
              {navigable ? (
                <Link
                  href={href}
                  className="rounded transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'font-medium text-zinc-600 dark:text-zinc-300' : ''}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
