'use client';
// WorkflowFileContent

import { useEffect, useMemo, useRef, useState } from 'react';
import { List, ChevronDown, Pencil, RefreshCw } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useTranslations } from 'next-intl';
import type { WorkflowTab } from './workflow-viewer-utils';
import { MarkdownView } from '../markdown/MarkdownView';
import { WorkflowFileEditor } from './WorkflowFileEditor';
import { PlanRevisionRequest } from './PlanRevisionRequest';

/** A heading extracted from markdown for the in-file table of contents. */
interface TocHeading {
  id: string;
  level: number;
  text: string;
}

/**
 * Builds a stable element id from heading text. Matched on BOTH sides (TOC link
 * + rendered <h2>) so links resolve by content, not document position — setext
 * or blockquote headings can no longer desync the numbering.
 *
 * @param text - Plain heading text / 見出しの素テキスト
 * @returns URL-safe slug (CJK preserved) / CJKを保持したスラッグ
 */
function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/\s+/g, '-')
      // Keep letters (incl. CJK via \p{L}) and numbers; drop punctuation.
      .replace(/[^\p{L}\p{N}-]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

/**
 * Builds the element id for a heading purely from its text. Deliberately has no
 * occurrence counter: a shared counter double-increments under React StrictMode's
 * double render, desyncing the rendered <h2> ids from the once-computed TOC ids.
 * Duplicate-named headings therefore share an id; links resolve to the first.
 *
 * @param text - Plain heading text / 見出しの素テキスト
 * @returns Element id / 要素id
 */
function headingId(text: string): string {
  return `wf-h-${slugifyHeading(text)}`;
}

/**
 * Extracts only H2 headings — the "section" titles rendered with the vertical
 * indigo bar — in document order (skipping fenced code). Ids are derived from
 * heading text (slug), so they match the rendered <h2> regardless of position.
 * Finer-grained headings (H1/H3+) are intentionally excluded. / h2見出しのみ抽出。
 *
 * @param md - Raw markdown source / Markdown原文
 * @returns Ordered H2 headings with stable ids / 安定idつきのh2見出し一覧
 */
function extractHeadings(md: string): TocHeading[] {
  const out: TocHeading[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const raw of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = raw.match(/^(##)\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    const id = headingId(text);
    // Drop later duplicates so the TOC has one entry per id (links hit the first).
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, level: m[1].length, text });
  }
  return out;
}

interface WorkflowFile {
  exists: boolean;
  content?: string | null;
  lastModified?: string | null;
  size?: number | null;
}

interface WorkflowFileContentProps {
  isLoading: boolean;
  activeFile: WorkflowFile | null;
  activeTabConfig: WorkflowTab;
  /** Whether to show the inline plan-approval CTA (plan tab + plan_created status) */
  showApprovalButton: boolean;
  onPlanApprovalRequest?: () => void;
  /** Task id — enables inline editing of the plan. / インライン編集に必要 */
  taskId?: number;
  /** Called after a successful inline save so the parent refetches. / 保存後の再取得 */
  onSaved?: () => void;
  /**
   * True when this tab's file was just archived by the phase-critic gate and
   * is being regenerated (see WorkflowViewer's criticRejectionPhase). Swaps
   * the generic "not yet generated" empty state for one that makes clear
   * nothing was lost — the plain empty state is indistinguishable from a
   * task that never ran this phase at all.
   */
  isRegenerating?: boolean;
}

/**
 * Renders the main content area for the active workflow tab.
 *
 * @param isLoading - True while initial file data is being fetched
 * @param activeFile - File metadata and content for the selected tab
 * @param activeTabConfig - Tab definition used for the empty-state icon/message
 * @param showApprovalButton - Show the plan-approval CTA inside the content area
 * @param onPlanApprovalRequest - Opens the plan-approval modal / 計画承認モーダルを開く
 */
export function WorkflowFileContent({
  isLoading,
  activeFile,
  activeTabConfig,
  showApprovalButton,
  onPlanApprovalRequest,
  taskId,
  onSaved,
  isRegenerating = false,
}: WorkflowFileContentProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const headings = useMemo(() => extractHeadings(activeFile?.content ?? ''), [activeFile?.content]);

  // Inline editing is offered for the plan only (refine before approving). It
  // requires a taskId (the save target); without it the tab stays read-only.
  const canEdit =
    activeTabConfig.id === 'plan' && !!activeFile?.exists && typeof taskId === 'number';
  const [isEditing, setIsEditing] = useState(false);
  // Leaving the plan tab (or losing the file) must drop edit mode so a stale
  // editor never lingers over a different tab's content.
  useEffect(() => {
    if (!canEdit) setIsEditing(false);
  }, [canEdit]);

  // The TOC is sticky and vertical, so its height varies with the heading count.
  // Measure it and feed the value into each <h2>'s scroll-margin-top so clicked
  // links land *below* the sticky bars instead of behind them. 88px = the stack
  // above the TOC: task-detail toolbar (44px) + sticky workflow tab bar (44px).
  const tocRef = useRef<HTMLElement | null>(null);
  const [tocHeight, setTocHeight] = useState(0);
  // Collapsible so the sticky TOC can shrink to just its label when not in use.
  // Default closed — it expands on demand and keeps the content area uncluttered.
  const [tocOpen, setTocOpen] = useState(false);
  useEffect(() => {
    const el = tocRef.current;
    if (!el) {
      setTocHeight(0);
      return;
    }
    // Measure synchronously on first render so scroll-margin-top is correct from
    // the first paint. RAF is used only for subsequent resize callbacks to prevent
    // "ResizeObserver loop completed with undelivered notifications".
    setTocHeight(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    let rafId: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setTocHeight(el.offsetHeight));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [headings, tocOpen]);
  const scrollMarginTop = tocHeight > 0 ? tocHeight + 88 + 8 : 132;

  if (isLoading && !activeFile) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="md" className="mr-2" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{tc('loading')}</span>
      </div>
    );
  }

  if (!activeFile?.exists) {
    if (isRegenerating) {
      return (
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-3">
            <RefreshCw className="h-6 w-6 text-amber-600 dark:text-amber-400 animate-spin" />
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t('fileContent.regenerating')}
          </p>
        </div>
      );
    }
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3">
          <activeTabConfig.icon className="h-6 w-6 text-zinc-500" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{activeTabConfig.emptyText}</p>
      </div>
    );
  }

  // Inline plan editor (replaces the read-only view while editing).
  if (isEditing && canEdit && typeof taskId === 'number') {
    return (
      <WorkflowFileEditor
        taskId={taskId}
        fileType="plan"
        initialContent={activeFile?.content || ''}
        onCancel={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onSaved?.();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Plan controls. Asking the PLANNER for a change is the preferred route:
          editing by hand means reading the whole document to change one line and
          leaves no record of why it changed, while plan.md is the contract the
          verify and adversarial gates judge the implementer against. */}
      {canEdit && typeof taskId === 'number' && (
        <div className="flex justify-end">
          <PlanRevisionRequest taskId={taskId} onRequested={onSaved} />
        </div>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('fileContent.editPlan')}
          </button>
        </div>
      )}
      {/* In-file table of contents — sticky so it stays clickable after the
          content scrolls. -mx-5/px-5 cancel the parent p-5 so the background
          spans the card. top:88px (inline, not an arbitrary class which may not
          be generated) sits just below the sticky tab bar, which itself sits
          below the task-detail toolbar. */}
      {headings.length > 0 && (
        <nav
          ref={tocRef}
          style={{ top: 88 }}
          className="sticky z-[5] -mx-5 -mt-5 flex flex-col gap-0.5 border-b border-zinc-200 bg-white px-5 py-2.5 dark:border-zinc-700 dark:bg-indigo-dark-900"
        >
          <button
            type="button"
            onClick={() => setTocOpen((open) => !open)}
            aria-expanded={tocOpen}
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <List className="h-3.5 w-3.5" />
            <span>{t('fileContent.tableOfContents')}</span>
            <span className="text-zinc-500/70 dark:text-zinc-500/70">({headings.length})</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${tocOpen ? '' : '-rotate-90'}`}
            />
          </button>
          {tocOpen && (
            <div className="mt-1 flex flex-col gap-0.5">
              {headings.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(h.id)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  title={h.text}
                  className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-xs font-medium text-zinc-600 transition-colors before:h-3 before:w-0.5 before:shrink-0 before:rounded-full before:bg-indigo-400/70 hover:bg-indigo-50 hover:text-indigo-700 dark:text-zinc-300 dark:before:bg-indigo-400/60 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
                >
                  {h.text}
                </button>
              ))}
            </div>
          )}
        </nav>
      )}

      {/* Markdown body — shared renderer (see MarkdownView); getHeadingId +
          scroll margin wire this viewer's in-file table of contents. */}
      <MarkdownView
        content={activeFile.content || ''}
        getHeadingId={headingId}
        headingScrollMarginTop={scrollMarginTop}
      />
      {/* Plan approval CTA (inside content area) */}
      {showApprovalButton && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t('planApprovalRequired')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {t('fileContent.approveToImplementHint')}
              </p>
            </div>
            <button
              onClick={onPlanApprovalRequest}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              {t('fileContent.approveAndImplement')}
            </button>
          </div>
        </div>
      )}

      {/* NOTE: The "実装完了" CTA was removed — verification auto-completes the
          task on success (verify handler), and force-completing a verify_done
          task here bypassed the completion/verification gate and skipped
          commit/PR. Stuck tasks should be fixed and re-run, not force-completed. */}
    </div>
  );
}
