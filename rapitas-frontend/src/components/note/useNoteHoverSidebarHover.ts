/**
 * useNoteHoverSidebarHover
 *
 * Hover-driven expand/collapse timing for NoteHoverSidebar (300ms debounce on
 * both enter and leave). Extracted from the component to keep it under the
 * size limit; behavior is unchanged.
 */
'use client';
import { useEffect, useRef, useState } from 'react';

export interface UseNoteHoverSidebarHoverReturn {
  isExpanded: boolean;
  isHovered: boolean;
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
}

/** Debounced hover state driving NoteHoverSidebar's expand/collapse animation. */
export function useNoteHoverSidebarHover(): UseNoteHoverSidebarHoverReturn {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(true), 300);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(false), 300);
  };
  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  return { isExpanded, isHovered, handleMouseEnter, handleMouseLeave };
}
