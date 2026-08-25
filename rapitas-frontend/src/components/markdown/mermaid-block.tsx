'use client';

/**
 * mermaid-block
 *
 * Renders a ```mermaid code fence from agent/user markdown as an inline SVG
 * diagram: mermaid is dynamically imported on first render (bundle stays lean),
 * runs with securityLevel 'strict' (untrusted input), follows the app's
 * dark/light theme, and falls back to the raw source with a subdued error line
 * when the diagram fails to parse — a broken fence must never crash the page.
 */

import { memo, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDarkMode } from '@/hooks/ui/useDarkMode';

// mermaid.render requires a document-unique element id per invocation.
let mermaidSeq = 0;

// Minimal structural view of the mermaid module (what this component calls) —
// avoids an `import()` type annotation, which our lint config forbids.
interface MermaidModule {
  default: {
    initialize: (config: {
      startOnLoad: boolean;
      securityLevel: 'strict';
      theme: 'dark' | 'neutral';
      [diagramType: string]: unknown;
    }) => void;
    render: (id: string, source: string) => Promise<{ svg: string }>;
  };
}

// Shared import promise: several diagrams on one page must load mermaid once
// (avoids duplicate work and keeps concurrent dynamic imports deterministic).
let mermaidModulePromise: Promise<MermaidModule> | null = null;
const loadMermaid = (): Promise<MermaidModule> => (mermaidModulePromise ??= import('mermaid'));

/**
 * Per-diagram overrides that stop mermaid scaling a diagram to its container.
 * mermaid takes `useMaxWidth` per diagram type rather than globally, so every
 * type this app can receive from agent markdown is listed.
 */
const INTRINSIC_SIZE_CONFIG = Object.fromEntries(
  [
    'flowchart',
    'sequence',
    'gantt',
    'class',
    'state',
    'er',
    'journey',
    'pie',
    'timeline',
    'mindmap',
    'gitGraph',
    'quadrantChart',
  ].map((diagramType) => [diagramType, { useMaxWidth: false }]),
);

interface MermaidBlockProps {
  /** Mermaid diagram source (code-fence body). / フェンス内のMermaidソース */
  source: string;
}

/**
 * Async mermaid diagram renderer with theme awareness and error fallback.
 *
 * @param source - Mermaid source to render. / 描画するMermaidソース
 * @returns Centered SVG container, or the raw source on failure. / SVGコンテナ（失敗時は原文）
 */
function MermaidBlockImpl({ source }: MermaidBlockProps) {
  const t = useTranslations('common');
  const { isDarkMode } = useDarkMode();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Re-renders on theme change so the diagram palette follows the app theme.
  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-md-${++mermaidSeq}`;
    (async () => {
      try {
        const { default: mermaid } = await loadMermaid();
        // NOTE: strict security — the markdown source is agent/user generated.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDarkMode ? 'dark' : 'neutral',
          // Render at the diagram's INTRINSIC size. mermaid's default
          // (useMaxWidth: true) emits width:100% plus a max-width, which scales
          // the whole diagram down to the container — inside the workflow
          // panel that shrank labels until they were unreadable. The container
          // scrolls instead of the diagram shrinking.
          ...INTRINSIC_SIZE_CONFIG,
        });
        const rendered = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(rendered.svg);
          setFailed(false);
        }
      } catch {
        // Mermaid can leave a temp element in the DOM on parse failure.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) {
          setFailed(true);
          setSvg(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, isDarkMode]);

  if (failed) {
    // Fall back to the familiar code-block look so the content stays readable.
    return (
      <div className="my-3">
        <pre className="!my-0 p-3 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-800 text-xs overflow-x-auto dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
          <code>{source}</code>
        </pre>
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          {t('mermaidRenderError')}
        </p>
      </div>
    );
  }

  return (
    // NOTE: a BLOCK container with overflow-x-auto, not flex. `flex
    // justify-center` makes the overflowing left edge unreachable once the
    // diagram is wider than the panel; `mx-auto w-fit` centres it when it fits
    // and scrolls cleanly when it does not.
    <div className="my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/60 p-3">
      {svg ? (
        <div
          className="mx-auto w-fit [&_svg]:h-auto [&_svg]:max-w-none"
          // NOTE: SVG string produced by mermaid with securityLevel 'strict'
          // (sanitized); the only way to mount its output.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          role="status"
          aria-label={t('mermaidRendering')}
          className="h-16 w-full max-w-sm animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
        />
      )}
    </div>
  );
}

// NOTE: The 3s workflow-file poll re-fetches the whole document; when content
// is byte-identical (the common case) useWorkflowFiles reuses the previous
// object reference, but without memo here this component would still
// re-render on every parent re-render and re-run mermaid.render for no
// reason. `source`/`isDarkMode` are primitives, so the default shallow
// comparison is exactly right.
export const MermaidBlock = memo(MermaidBlockImpl);

interface HastNodeLike {
  type?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNodeLike[];
  value?: string;
}

/**
 * Extracts the mermaid source when a `<pre>` hast node wraps a mermaid fence.
 * Structural typing keeps us off the transitive `hast` type package.
 *
 * @param node - The `node` prop react-markdown passes to a `pre` override. / preオーバーライドのhastノード
 * @returns The fence body, or null for non-mermaid blocks. / Mermaidソース（該当しなければnull）
 */
export function extractMermaidSource(node: unknown): string | null {
  const pre = node as HastNodeLike | null | undefined;
  const code = pre?.children?.find((child) => child.tagName === 'code');
  if (!code) return null;
  const rawClass = code.properties?.className;
  const classes = Array.isArray(rawClass)
    ? rawClass.filter((c): c is string => typeof c === 'string')
    : typeof rawClass === 'string'
      ? [rawClass]
      : [];
  if (!classes.includes('language-mermaid')) return null;
  return (code.children ?? [])
    .map((child) => (child.type === 'text' && typeof child.value === 'string' ? child.value : ''))
    .join('')
    .replace(/\n$/, '');
}
