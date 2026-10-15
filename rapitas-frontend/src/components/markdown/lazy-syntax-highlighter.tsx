'use client';

/**
 * lazy-syntax-highlighter
 *
 * next/dynamic wrapper that defers SyntaxHighlightedCode (react-syntax-highlighter
 * plus its theme objects) into a client-only async chunk. Shows the shared
 * SkeletonBlock while the chunk resolves so code blocks keep their footprint.
 */

import dynamic from 'next/dynamic';
import { SkeletonBlock } from '@/components/ui/skeleton/skeleton-blocks';

export type { SyntaxHighlightedCodeProps, SyntaxHighlightTheme } from './syntax-highlighted-code';

// NOTE: ssr:false — the highlighter is client-render only; dynamic() keeps it
// out of every eager chunk, which is the point of this wrapper (bundle budget).
export const LazySyntaxHighlighter = dynamic(() => import('./syntax-highlighted-code'), {
  ssr: false,
  loading: () => <SkeletonBlock className="h-24 w-full my-4" />,
});
