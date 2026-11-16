/**
 * settings-modal-store
 *
 * Whether the app-wide settings modal is open and which section it shows.
 * Settings used to be the /settings/* pages; they are now one modal over the
 * current page, so this store is the only "address" a settings section has.
 * Not responsible for rendering (SettingsModal) or for mapping old
 * /settings URLs to sections (settings-link).
 */
import { create } from 'zustand';

/** Every section the settings modal can show, in sidebar order. */
export const SETTINGS_SECTION_IDS = [
  'personal',
  'general',
  'api-keys',
  'developer-mode',
  'shortcuts',
  'cli-tools',
] as const;

/** One settings section. */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** Section shown when the modal is opened without naming one. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';

interface SettingsModalState {
  /** Whether the modal is shown. */
  isOpen: boolean;
  /** The section in the content pane (kept while closed, so reopening resumes). */
  section: SettingsSectionId;
  /** Opens the modal, on the given section or the last one shown. */
  open: (section?: SettingsSectionId) => void;
  /** Closes the modal. */
  close: () => void;
  /** Switches the content pane to another section. */
  setSection: (section: SettingsSectionId) => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  section: DEFAULT_SETTINGS_SECTION,
  open: (section) => set((s) => ({ isOpen: true, section: section ?? s.section })),
  close: () => set({ isOpen: false }),
  setSection: (section) => set({ section }),
}));

/**
 * Opens the settings modal from anywhere (event handlers, non-React code).
 *
 * @param section - Section to show; omitted keeps the last one / 表示する項目
 */
export function openSettings(section?: SettingsSectionId): void {
  useSettingsModalStore.getState().open(section);
}
