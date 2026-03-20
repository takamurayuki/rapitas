/**
 * icon-registry
 *
 * Aggregates all icon data from split sub-files and re-exports the combined
 * ICON_DATA record and IconInfo type for use throughout the category feature.
 *
 * Sub-files live in ./icons/ and are grouped by icon category. Each file is
 * kept under 300 lines. Add new icons to the appropriate sub-file, then the
 * merged export here picks them up automatically via object spread.
 */

import { type LucideIcon } from 'lucide-react';

import { GENERAL_ICONS } from './icons/general';
import { BUSINESS_TASKS_ICONS } from './icons/business-tasks';
import { NAVIGATION_PEOPLE_ICONS } from './icons/navigation-people';
import { EDUCATION_TECH_ICONS } from './icons/education-tech';
import { DEVELOPMENT_CREATIVE_ICONS } from './icons/development-creative';
import { FOOD_NATURE_ICONS } from './icons/food-nature';
import { TRANSPORT_HEALTH_ICONS } from './icons/transport-health';
import { HOME_TRAVEL_ICONS } from './icons/home-travel';
import { UI_OTHER_ICONS } from './icons/ui-other';

/** Metadata for a single icon entry: the Lucide component and searchable Japanese keywords. */
export type IconInfo = {
  component: LucideIcon;
  keywords: string[];
};

/**
 * Combined icon registry with Japanese keyword metadata.
 *
 * Assembled by merging all category-specific sub-registries. Consumers that
 * previously imported ICON_DATA from this file continue to work unchanged.
 */
export const ICON_DATA: Record<string, IconInfo> = {
  ...GENERAL_ICONS,
  ...BUSINESS_TASKS_ICONS,
  ...NAVIGATION_PEOPLE_ICONS,
  ...EDUCATION_TECH_ICONS,
  ...DEVELOPMENT_CREATIVE_ICONS,
  ...FOOD_NATURE_ICONS,
  ...TRANSPORT_HEALTH_ICONS,
  ...HOME_TRAVEL_ICONS,
  ...UI_OTHER_ICONS,
};
