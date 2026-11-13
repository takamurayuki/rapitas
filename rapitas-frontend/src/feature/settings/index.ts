/**
 * feature/settings
 *
 * Public surface of the settings modal: the modal itself, the store that
 * opens it, and the helper that maps old /settings URLs onto it.
 */
export { SettingsModal } from './SettingsModal';
export {
  useSettingsModalStore,
  openSettings,
  SETTINGS_SECTION_IDS,
  DEFAULT_SETTINGS_SECTION,
  type SettingsSectionId,
} from './settings-modal-store';
export { followInAppLink, settingsSectionFromHref } from './settings-link';
