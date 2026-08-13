/**
 * WorkflowQuestionPanel.test
 *
 * Component tests for the Q&A panel: Markdown rendering of the question
 * body, the hideFreeText / freeTextReason display branches, and option
 * selection triggering onAnswer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowQuestionPanel } from './WorkflowQuestionPanel';
import type { LiveQuestion } from '@/stores/execution-state-store';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const baseQuestion: LiveQuestion = {
  taskId: 1,
  text: '## 見出し\n\n| A | B |\n| - | - |\n| 1 | 2 |',
  options: ['選択肢A', '選択肢B'],
};

describe('WorkflowQuestionPanel', () => {
  it('renders the question body as Markdown (heading + table)', () => {
    render(<WorkflowQuestionPanel question={baseQuestion} submitting={false} onAnswer={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: '見出し' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('clicking an option button then submit calls onAnswer with the option text', () => {
    const onAnswer = vi.fn();
    render(
      <WorkflowQuestionPanel question={baseQuestion} submitting={false} onAnswer={onAnswer} />,
    );
    fireEvent.click(screen.getByText('選択肢A'));
    fireEvent.click(screen.getByText('questionPanel.submit'));
    expect(onAnswer).toHaveBeenCalledWith('選択肢A');
  });

  it('shows the free-text row by default (no hideFreeText)', () => {
    render(<WorkflowQuestionPanel question={baseQuestion} submitting={false} onAnswer={vi.fn()} />);
    expect(
      screen.getByPlaceholderText('questionPanel.freeTextInputPlaceholder'),
    ).toBeInTheDocument();
  });

  it('hides the free-text row when hideFreeText is set, but keeps the submit button', () => {
    const onAnswer = vi.fn();
    render(
      <WorkflowQuestionPanel
        question={baseQuestion}
        submitting={false}
        onAnswer={onAnswer}
        hideFreeText
      />,
    );
    expect(
      screen.queryByPlaceholderText('questionPanel.freeTextInputPlaceholder'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('選択肢B'));
    fireEvent.click(screen.getByText('questionPanel.submit'));
    expect(onAnswer).toHaveBeenCalledWith('選択肢B');
  });

  it('shows the freeTextReason notice when freeTextOnly + freeTextReason are set', () => {
    render(
      <WorkflowQuestionPanel
        question={baseQuestion}
        submitting={false}
        onAnswer={vi.fn()}
        freeTextOnly
        freeTextReason="APIキーは選択肢で表現できないため"
      />,
    );
    expect(
      screen.getByText(
        'questionPanel.freeTextRequiredNotice:{"reason":"APIキーは選択肢で表現できないため"}',
      ),
    ).toBeInTheDocument();
  });

  it('does not show the freeTextReason notice when freeTextOnly is set without a reason', () => {
    render(
      <WorkflowQuestionPanel
        question={baseQuestion}
        submitting={false}
        onAnswer={vi.fn()}
        freeTextOnly
      />,
    );
    expect(screen.queryByText(/freeTextRequiredNotice/)).not.toBeInTheDocument();
  });
});
