/**
 * SlidePanelContext
 *
 * Signals to descendants that they are rendered inside a TaskSlidePanel.
 * Consumers can adjust behaviour — e.g. NoteChipLink opens the note in a
 * modal overlay instead of navigating away and closing the panel.
 */
import { createContext, useContext } from 'react';

export const SlidePanelContext = createContext(false);

/** Returns true when rendered inside a TaskSlidePanel. */
export const useIsInSlidePanel = () => useContext(SlidePanelContext);
