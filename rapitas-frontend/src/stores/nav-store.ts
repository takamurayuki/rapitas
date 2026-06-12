import { create } from 'zustand';

/**
 * nav-store
 *
 * Shares the side-nav pinned state across the app shell so page content can
 * make room for the pinned panel. The Header owns the canonical pin state
 * (with its own persistence) and mirrors it here; this store is read by the
 * content wrapper only. Not responsible for opening/closing the nav.
 */
interface NavState {
  /** Whether the side nav is pinned open. */
  isMenuPinned: boolean;
  /** Mirrors the Header's pin state into the store. */
  setMenuPinned: (pinned: boolean) => void;
}

export const useNavStore = create<NavState>((set) => ({
  isMenuPinned: false,
  setMenuPinned: (pinned) => set({ isMenuPinned: pinned }),
}));
