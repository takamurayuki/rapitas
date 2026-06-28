'use client';
// useEditorInsertion
import { useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { isInTitleInput } from './formatting';
import { createCodeBlockNode, normalizeCodeBlocks } from './code-block';
import { createLinkNode } from './link-card';
import { createTableNode } from './table';
import { createDiagramBlockNode, renderMermaidBlock } from './diagram-block';

/**
 * Refs required for DOM insertion operations.
 */
export interface InsertionRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  savedSelectionRef: React.MutableRefObject<Range | null>;
}

/**
 * State setters needed to manage UI feedback during insertion.
 */
export interface InsertionSetters {
  setIsLinkLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLinkInput: React.Dispatch<React.SetStateAction<boolean>>;
  setLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  setShowCodeInput: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Values returned by useEditorInsertion.
 */
export interface EditorInsertionHandlers {
  insertNodeAtCursor: (node: Node) => void;
  insertLink: () => Promise<void>;
  insertTable: () => void;
  insertCodeBlock: () => void;
  insertDiagramBlock: () => void;
  openLinkInput: () => void;
  openCodeInput: () => void;
}

/**
 * Provides DOM-insertion handlers for links, code blocks, and tables.
 *
 * @param refs - Refs to the editor div and saved selection.
 * @param setters - State setters for link/code popup visibility and loading state.
 * @param linkUrl - Current value of the link URL input field.
 * @param codeLanguage - Currently selected code language for block insertion.
 * @param handleContentChange - Callback to mark the editor as dirty.
 * @param closeOtherPopups - Callback to dismiss all other open popups.
 * @returns Object containing all insertion handler functions.
 */
export function useEditorInsertion(
  refs: InsertionRefs,
  setters: InsertionSetters,
  linkUrl: string,
  codeLanguage: string,
  handleContentChange: () => void,
  closeOtherPopups: (except: 'link' | 'code') => void,
): EditorInsertionHandlers {
  const { contentRef, savedSelectionRef } = refs;
  const { setIsLinkLoading, setShowLinkInput, setLinkUrl, setShowCodeInput } = setters;

  const insertNodeAtCursor = useCallback(
    (node: Node) => {
      const selection = window.getSelection();
      if (savedSelectionRef.current && selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(node);
        const newRange = document.createRange();
        newRange.setStartAfter(node);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      } else if (contentRef.current) {
        contentRef.current.appendChild(node);
      }
    },
    [contentRef, savedSelectionRef],
  );

  const openLinkInput = useCallback(() => {
    if (isInTitleInput()) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    closeOtherPopups('link');
    setShowLinkInput(true);
    setLinkUrl('');
  }, [contentRef, savedSelectionRef, setShowLinkInput, setLinkUrl, closeOtherPopups]);

  const openCodeInput = useCallback(() => {
    if (isInTitleInput()) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    closeOtherPopups('code');
    setShowCodeInput(true);
  }, [contentRef, savedSelectionRef, setShowCodeInput, closeOtherPopups]);

  const insertLink = useCallback(async () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    setIsLinkLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/url-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const meta = await res.json();
      const linkNode = createLinkNode(url, meta.title || url, meta.favicon || '');
      insertNodeAtCursor(linkNode);
      handleContentChange();
    } catch {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      insertNodeAtCursor(a);
      handleContentChange();
    } finally {
      setIsLinkLoading(false);
      setShowLinkInput(false);
      setLinkUrl('');
      savedSelectionRef.current = null;
    }
  }, [
    linkUrl,
    insertNodeAtCursor,
    handleContentChange,
    setIsLinkLoading,
    setShowLinkInput,
    setLinkUrl,
    savedSelectionRef,
  ]);

  const insertTable = useCallback(() => {
    if (isInTitleInput()) return;
    if (!contentRef.current?.contains(document.activeElement)) {
      contentRef.current?.focus();
    }
    const frag = createTableNode();
    const lastChild = frag.lastChild;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!contentRef.current?.contains(range.commonAncestorContainer)) return;
      range.deleteContents();
      range.insertNode(frag);
      if (lastChild) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastChild);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }
    handleContentChange();
  }, [contentRef, handleContentChange]);

  const insertCodeBlock = useCallback(() => {
    const frag = createCodeBlockNode(codeLanguage);
    const lastChild = frag.lastChild;

    if (savedSelectionRef.current) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(frag);
        if (lastChild) {
          const newRange = document.createRange();
          newRange.setStartAfter(lastChild);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }

    if (contentRef.current) {
      // Wire up delete buttons and key handlers via the shared normalizer.
      normalizeCodeBlocks(contentRef.current, handleContentChange);
      contentRef.current
        .querySelectorAll('[data-needs-delete-handler]')
        .forEach((b) => (b as HTMLElement).removeAttribute('data-needs-delete-handler'));
    }

    handleContentChange();
    setShowCodeInput(false);
    savedSelectionRef.current = null;
  }, [codeLanguage, contentRef, savedSelectionRef, handleContentChange, setShowCodeInput]);

  const insertDiagramBlock = useCallback(() => {
    if (!contentRef.current?.contains(document.activeElement)) {
      contentRef.current?.focus();
    }
    const frag = createDiagramBlockNode();
    // The fragment's first child is the wrapper div — we need it to render the SVG after insertion.
    const wrapperEl = frag.firstElementChild as HTMLElement | null;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(frag);
      } else {
        contentRef.current?.appendChild(frag);
      }
    } else if (contentRef.current) {
      contentRef.current.appendChild(frag);
    }

    handleContentChange();

    // Async render — no need to await; UI updates when Mermaid resolves.
    if (wrapperEl) renderMermaidBlock(wrapperEl);
  }, [contentRef, handleContentChange]);

  return {
    insertNodeAtCursor,
    insertLink,
    insertTable,
    insertCodeBlock,
    insertDiagramBlock,
    openLinkInput,
    openCodeInput,
  };
}
