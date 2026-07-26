/**
 * KnowledgeEntryCard.test
 *
 * Regression coverage: a legacy "consolidated" KnowledgeEntry whose tags
 * array picked up a stray non-string element (the hypothesis ledger
 * overloads the same tags column with `{evidence:[...]}` — see
 * services/memory/consolidation.ts) used to crash this card with "Objects
 * are not valid as a React child" the moment React reached that element in
 * the tag-pill .map(). The card is typed to expect tags: string[], but must
 * not crash when reality doesn't match that type (fixed at the source now,
 * but old rows may still exist).
 */
import { render, screen } from '@testing-library/react';
import { KnowledgeEntryCard } from '../KnowledgeEntryCard';
import type { KnowledgeEntry } from '../../types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function baseEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 1,
    sourceType: 'consolidated',
    sourceId: null,
    title: 'Test entry',
    content: 'Some content',
    contentHash: 'abc',
    category: 'other',
    tags: ['alpha', 'beta'],
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

describe('KnowledgeEntryCard', () => {
  it('renders ordinary string tags normally', () => {
    render(<KnowledgeEntryCard entry={baseEntry()} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('does not crash and silently drops a stray non-string tag element', () => {
    // Simulates the corrupted-consolidation runtime shape (typed as
    // string[], but a legacy row's tags actually contains a raw object).
    const corruptedTags = ['consolidated', { evidence: [{ stance: 'for' }] }, 'real-tag'];
    const entry = baseEntry({ tags: corruptedTags as unknown as string[] });

    expect(() => render(<KnowledgeEntryCard entry={entry} />)).not.toThrow();
    expect(screen.getByText('consolidated')).toBeInTheDocument();
    expect(screen.getByText('real-tag')).toBeInTheDocument();
  });

  it('renders no tag pills when every tag element is non-string', () => {
    const entry = baseEntry({
      tags: [{ evidence: [] }] as unknown as string[],
    });
    render(<KnowledgeEntryCard entry={entry} />);
    expect(screen.queryByText('evidence')).not.toBeInTheDocument();
  });
});
