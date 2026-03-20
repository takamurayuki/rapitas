/**
 * useAccordionState
 *
 * Manages accordion open/close state and analysis tab selection.
 * Resets to a neutral state whenever the active taskId changes.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AccordionSection, AnalysisTabType } from './types';

type UseAccordionStateOptions = {
  taskId: number;
  onTaskChange?: () => void;
};

type UseAccordionStateResult = {
  expandedSection: AccordionSection | null;
  setExpandedSection: (section: AccordionSection | null) => void;
  toggleSection: (section: AccordionSection) => void;
  analysisTab: AnalysisTabType;
  setAnalysisTab: (tab: AnalysisTabType) => void;
};

/**
 * Provides accordion expansion state and analysis tab selection.
 * Collapses all sections and resets tab when taskId changes.
 *
 * @param options.taskId - The current task identifier; triggers reset on change.
 * @param options.onTaskChange - Optional callback invoked alongside the reset.
 * @returns Accordion and tab state with toggle helpers.
 */
export function useAccordionState({
  taskId,
  onTaskChange,
}: UseAccordionStateOptions): UseAccordionStateResult {
  const [expandedSection, setExpandedSection] =
    useState<AccordionSection | null>(null);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTabType>('subtasks');
  const prevTaskIdRef = useRef(taskId);

  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      setExpandedSection(null);
      onTaskChange?.();
    }
  }, [taskId, onTaskChange]);

  const toggleSection = useCallback((section: AccordionSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  }, []);

  return {
    expandedSection,
    setExpandedSection,
    toggleSection,
    analysisTab,
    setAnalysisTab,
  };
}
