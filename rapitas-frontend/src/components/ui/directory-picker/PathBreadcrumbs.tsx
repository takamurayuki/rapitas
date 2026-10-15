'use client';

/**
 * directory-picker/PathBreadcrumbs
 *
 * Renders the current browse path as clickable per-segment breadcrumbs so any
 * ancestor directory is reachable in one click.
 * Not responsible for path fetching — navigation is delegated via onNavigate.
 */

import { ChevronRight } from 'lucide-react';

type PathSegment = {
  label: string;
  path: string;
};

/**
 * Splits an absolute path into breadcrumb segments with their full paths.
 * Handles Windows drive paths (C:\...) and POSIX paths (/...). Returns an
 * empty array for unsupported shapes (e.g. UNC paths) so the caller can fall
 * back to plain text.
 *
 * @param path - Absolute filesystem path / 絶対パス
 * @returns Ordered breadcrumb segments / 先頭から順のパンくずセグメント
 */
export function parsePathSegments(path: string): PathSegment[] {
  if (!path) return [];
  if (/^[A-Za-z]:/.test(path)) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    // NOTE: A bare drive letter needs the trailing separator ("C:\") —
    // browsing "C:" resolves relative to the server process cwd.
    return parts.map((part, i) => ({
      label: part,
      path: i === 0 ? `${part}\\` : parts.slice(0, i + 1).join('\\'),
    }));
  }
  if (path.startsWith('/')) {
    const parts = path.split('/').filter(Boolean);
    return [
      { label: '/', path: '/' },
      ...parts.map((part, i) => ({ label: part, path: `/${parts.slice(0, i + 1).join('/')}` })),
    ];
  }
  return [];
}

type PathBreadcrumbsProps = {
  currentPath: string;
  isLoading: boolean;
  onNavigate: (path: string) => void;
};

/**
 * Clickable breadcrumb trail for the directory browser toolbar.
 *
 * @param currentPath - Path currently displayed in the browser / 現在表示中のパス
 * @param isLoading - Whether a browse request is in-flight (disables clicks) / 読み込み中フラグ
 * @param onNavigate - Navigate to the clicked segment's path / セグメントクリック時の移動コールバック
 */
export function PathBreadcrumbs({ currentPath, isLoading, onNavigate }: PathBreadcrumbsProps) {
  const segments = parsePathSegments(currentPath);

  if (segments.length === 0) {
    // Fallback for path shapes we cannot segment (e.g. UNC paths).
    return (
      <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">
        {currentPath}
      </span>
    );
  }

  return (
    <nav aria-label={currentPath} className="flex items-center gap-0.5 min-w-0">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={segment.path} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" aria-hidden />}
            {isLast ? (
              <span
                aria-current="location"
                className="px-1 py-0.5 text-sm font-mono font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap"
              >
                {segment.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segment.path)}
                disabled={isLoading}
                title={segment.path}
                className="px-1 py-0.5 rounded text-sm font-mono text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {segment.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
