/**
 * settings-sections
 *
 * What each settings-modal section is called, which icon it shows in the
 * sidebar, and which component renders it. Sections load on demand, so the
 * settings code stays out of the bundle until the modal is first opened.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { Bot, Keyboard, KeyRound, SlidersHorizontal, Terminal, UserPen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { SettingsSectionId } from './settings-modal-store';

/** How one section appears in the modal. */
export interface SettingsSectionDefinition {
  /** Key under the `settings` i18n namespace. */
  labelKey: string;
  /** Sidebar icon — the same glyph the section's old page header used. */
  icon: LucideIcon;
  /** Renders the section's content. */
  Component: ComponentType;
}

const loading = () => <LoadingSpinner />;

export const SETTINGS_SECTIONS: Record<SettingsSectionId, SettingsSectionDefinition> = {
  personal: {
    labelKey: 'layout.personalTab',
    icon: UserPen,
    Component: dynamic(() => import('./sections/personal/PersonalSettings'), { loading }),
  },
  general: {
    labelKey: 'layout.generalTab',
    icon: SlidersHorizontal,
    Component: dynamic(() => import('./sections/general/GeneralSettings'), { loading }),
  },
  'api-keys': {
    labelKey: 'title',
    icon: KeyRound,
    Component: dynamic(() => import('./sections/api-keys/ApiKeysSettings'), { loading }),
  },
  'developer-mode': {
    labelKey: 'devModeTitle',
    icon: Bot,
    Component: dynamic(() => import('./sections/developer-mode/DeveloperModeSettings'), {
      loading,
    }),
  },
  shortcuts: {
    labelKey: 'layout.shortcutsTab',
    icon: Keyboard,
    Component: dynamic(() => import('./sections/shortcuts/ShortcutsSettings'), { loading }),
  },
  'cli-tools': {
    labelKey: 'layout.cliToolsTab',
    icon: Terminal,
    Component: dynamic(() => import('./sections/cli-tools/CliToolsSettings'), { loading }),
  },
};
