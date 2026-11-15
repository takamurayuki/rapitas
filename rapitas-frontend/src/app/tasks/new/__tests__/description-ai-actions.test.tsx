/**
 * description-ai-actions.test
 *
 * The title and spec drafts were two identical AI buttons on two different
 * headers (#1557). They now sit together under the description they both
 * read, say what they make, and wait for a description.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { DescriptionAiActions } from '../components/DescriptionAiActions';

function renderActions(hasDescription: boolean) {
  const onGenerateTitle = vi.fn();
  const onDeriveSpec = vi.fn();
  render(
    <DescriptionAiActions
      hasDescription={hasDescription}
      isGeneratingTitle={false}
      onGenerateTitle={onGenerateTitle}
      isDerivingSpec={false}
      onDeriveSpec={onDeriveSpec}
    />,
  );
  return { onGenerateTitle, onDeriveSpec };
}

const button = (key: string) =>
  document.querySelector(`[data-ai-draft="${key}"]`) as HTMLButtonElement;

describe('the AI drafts under the description', () => {
  it('names what each one makes, after saying what they read', () => {
    renderActions(true);
    expect(screen.getByText('aiDraftLead')).toBeTruthy();
    expect(button('title').textContent).toContain('titleGenerate');
    expect(button('spec').textContent).toContain('specDerive');
  });

  it('waits for a description, and says so', () => {
    renderActions(false);
    expect(button('title').disabled).toBe(true);
    expect(button('spec').disabled).toBe(true);
    expect(screen.getByText('aiDraftNeedsDescription')).toBeTruthy();
  });

  it('runs the draft that was pressed', () => {
    const { onGenerateTitle, onDeriveSpec } = renderActions(true);
    fireEvent.click(button('spec'));
    expect(onDeriveSpec).toHaveBeenCalledTimes(1);
    expect(onGenerateTitle).not.toHaveBeenCalled();
    expect(screen.queryByText('aiDraftNeedsDescription')).toBeNull();
  });

  it('warns, in the hint, that a draft replaces what is entered', () => {
    renderActions(true);
    expect(button('title').title).toBe('titleGenerateTooltip');
    expect(button('spec').title).toBe('specDeriveTooltip');
  });
});
