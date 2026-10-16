/**
 * KnowledgeEntryCard.i18n.test
 *
 * Regression coverage for MISSING_MESSAGE: KnowledgeEntryCard.test.tsx mocks
 * next-intl's useTranslations to echo the key back, so it can never catch a
 * real gap between `entry.category`/`entry.sourceType` values and the
 * `knowledge.categories.*`/`knowledge.sourceTypes.*` message catalogs. This
 * file renders with the real ja/en catalogs (like KnowledgeClient.test.tsx)
 * across every declared KnowledgeCategory/KnowledgeSourceType value so a
 * future union member added without a matching translation key fails here
 * instead of surfacing as a console MISSING_MESSAGE error in production.
 */
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { KnowledgeEntryCard } from '../KnowledgeEntryCard';
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeSourceType } from '../../types';
import ja from '../../../../../messages/ja.json';
import en from '../../../../../messages/en.json';

const ALL_CATEGORIES: KnowledgeCategory[] = [
  'procedure',
  'fact',
  'pattern',
  'preference',
  'insight',
  'general',
  'bug',
  'refactor',
  'security',
  'perf',
  'other',
  'codebase',
  'agent-behavior',
  'architecture',
  'improvement',
  'bug_noticed',
  'tech_debt',
  'ux',
  'feature',
  'performance',
];

const ALL_SOURCE_TYPES: KnowledgeSourceType[] = [
  'agent_execution',
  'user_learning',
  'task_pattern',
  'distilled_procedure',
  'consolidated',
  'concern',
  'hypothesis',
  'idea_box',
  'retrospective',
  'failure_lesson',
];

function baseEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 1,
    sourceType: 'agent_execution',
    sourceId: null,
    title: 'Test entry',
    content: 'Some content',
    contentHash: 'abc',
    category: 'procedure',
    tags: [],
    confidence: 0.8,
    accessCount: 0,
    lastAccessedAt: null,
    forgettingStage: 'active',
    decayScore: 1,
    lastDecayAt: new Date().toISOString(),
    pinnedUntil: null,
    validationStatus: 'validated',
    validatedAt: null,
    validationMethod: null,
    themeId: null,
    taskId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe.each([
  { locale: 'ja', messages: ja },
  { locale: 'en', messages: en },
])('KnowledgeEntryCard i18n coverage ($locale)', ({ locale, messages }) => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.each(ALL_CATEGORIES)('resolves a message for category "%s"', (category) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
        <KnowledgeEntryCard entry={baseEntry({ category })} />
      </NextIntlClientProvider>,
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(ALL_SOURCE_TYPES)('resolves a message for sourceType "%s"', (sourceType) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
        <KnowledgeEntryCard entry={baseEntry({ sourceType })} />
      </NextIntlClientProvider>,
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
