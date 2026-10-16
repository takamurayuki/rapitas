/**
 * StructuredQuestionFlow.test
 *
 * Component tests for the json:options 1問1答 flow: option selection →
 * confirm dialog → onSubmitAll(answerText, selections), the freeTextRequired
 * textarea + reason branch, the back button, and the optional question.md
 * prose body rendered above the flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StructuredQuestionFlow } from './StructuredQuestionFlow';
import type { StructuredQuestion } from './workflow-question-utils';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const confirmMock = vi.fn();
vi.mock('../ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => confirmMock,
}));

const QUESTIONS: StructuredQuestion[] = [
  {
    id: 'Q1',
    summary: '達成すべきゴール',
    options: [
      { key: 'A', label: '速度を優先する', consequence: '実装は最小限にする' },
      { key: 'B', label: '品質を優先する', consequence: 'テストを手厚くする' },
    ],
    freeTextRequired: false,
    freeTextReason: null,
    recommendedKey: null,
    recommendedReason: null,
  },
  {
    id: 'Q2',
    summary: 'APIキー',
    options: [],
    freeTextRequired: true,
    freeTextReason: '選択肢で表現できない秘匿情報のため',
    recommendedKey: null,
    recommendedReason: null,
  },
];

const QUESTION_WITH_RECOMMENDATION: StructuredQuestion = {
  id: 'Q1',
  summary: '達成すべきゴール',
  options: [
    { key: 'A', label: '速度を優先する', consequence: '実装は最小限にする' },
    { key: 'B', label: '品質を優先する', consequence: 'テストを手厚くする' },
  ],
  freeTextRequired: false,
  freeTextReason: null,
  recommendedKey: 'B',
  recommendedReason: 'plan.md §テスト戦略の実測値に基づき品質優先が妥当',
};

describe('StructuredQuestionFlow', () => {
  beforeEach(() => {
    confirmMock.mockReset();
  });

  it('selecting the last question option shows confirm and calls onSubmitAll on confirm', async () => {
    confirmMock.mockResolvedValue(true);
    const onSubmitAll = vi.fn();
    render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={onSubmitAll}
      />,
    );
    fireEvent.click(screen.getByText('品質を優先する'));
    fireEvent.click(screen.getByText('intakeQuestionFlow.submitAll'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    await waitFor(() => expect(onSubmitAll).toHaveBeenCalled());
    const [answerText, selections] = onSubmitAll.mock.calls[0];
    expect(answerText).toContain('選択: 品質を優先する（影響: テストを手厚くする）');
    expect(selections).toEqual([{ questionId: 'Q1', selectedKey: 'B' }]);
  });

  it('does not call onSubmitAll when the user cancels the confirm dialog', async () => {
    confirmMock.mockResolvedValue(false);
    const onSubmitAll = vi.fn();
    render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={onSubmitAll}
      />,
    );
    fireEvent.click(screen.getByText('速度を優先する'));
    fireEvent.click(screen.getByText('intakeQuestionFlow.submitAll'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(onSubmitAll).not.toHaveBeenCalled();
  });

  it('shows the freeTextRequired textarea + reason for a freeTextRequired question', () => {
    render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[1]]}
        submitting={false}
        onSubmitAll={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('questionPanel.freeTextPlaceholder')).toBeInTheDocument();
    // The freeTextReason notice line renders (interpolation itself is covered
    // by WorkflowQuestionPanel.test.tsx; here we assert it's shown at all).
    expect(screen.getByText('questionPanel.freeTextRequiredNotice')).toBeInTheDocument();
  });

  it('renders the back button on the second question and returns to the first on click', () => {
    render(
      <StructuredQuestionFlow questions={QUESTIONS} submitting={false} onSubmitAll={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('品質を優先する'));
    fireEvent.click(screen.getByText('intakeQuestionFlow.nextQuestion'));
    expect(screen.getByText('intakeQuestionFlow.previousQuestion')).toBeInTheDocument();
    fireEvent.click(screen.getByText('intakeQuestionFlow.previousQuestion'));
    expect(screen.getByText('速度を優先する')).toBeInTheDocument();
  });

  it('renders the question.md prose body (headings/tables) as Markdown when body is provided', () => {
    render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={vi.fn()}
        body={'## 背景\n\n| 項目 | 値 |\n| --- | --- |\n| 対象 | 質問タブ |'}
      />,
    );
    expect(screen.getByTestId('structured-question-body')).toBeInTheDocument();
    // Heading and table cell prove Markdown structure survived (not raw text).
    expect(screen.getByRole('heading', { name: '背景' })).toBeInTheDocument();
    expect(screen.getByText('質問タブ')).toBeInTheDocument();
  });

  it('shows the recommended option first with a badge and renders the recommendation reason', () => {
    render(
      <StructuredQuestionFlow
        questions={[QUESTION_WITH_RECOMMENDATION]}
        submitting={false}
        onSubmitAll={vi.fn()}
      />,
    );
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent?.includes('優先する'));
    expect(buttons[0].textContent).toContain('品質を優先する');
    expect(buttons[0].textContent).toContain('questionPanel.recommendedBadge');
    expect(screen.getByText('questionPanel.recommendedReasonLabel')).toBeInTheDocument();
    expect(
      screen.getByText(/plan\.md §テスト戦略の実測値に基づき品質優先が妥当/),
    ).toBeInTheDocument();
  });

  it('shows no recommendation badge or reason when recommendedKey is unset', () => {
    render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={vi.fn()}
      />,
    );
    expect(screen.queryByText('questionPanel.recommendedBadge')).not.toBeInTheDocument();
    expect(screen.queryByText('questionPanel.recommendedReasonLabel')).not.toBeInTheDocument();
  });

  it('does not render the body wrapper when body is empty or omitted', () => {
    const { rerender } = render(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={vi.fn()}
        body=""
      />,
    );
    expect(screen.queryByTestId('structured-question-body')).not.toBeInTheDocument();
    rerender(
      <StructuredQuestionFlow
        questions={[QUESTIONS[0]]}
        submitting={false}
        onSubmitAll={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('structured-question-body')).not.toBeInTheDocument();
  });
});
