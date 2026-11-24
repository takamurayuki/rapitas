/**
 * WorkflowStatusIndicator.test
 *
 * While a saved verify.md waits for the adversarial diff review the pill reads
 * 「検証中（差分レビュー）」; otherwise in_progress stays 「検証中」 (task 1538).
 * Rendered with the real Japanese messages so the copy itself is checked.
 */
import { render } from '@testing-library/react';
import ja from '../../../../messages/fragments/ja/16-workflow.json';
import WorkflowStatusIndicator from '../WorkflowStatusIndicator';

function lookup(path: string): string {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      (ja as Record<string, unknown>).workflow,
    ) as string;
}

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => (ns === 'workflow' ? lookup(key) : key),
}));

describe('WorkflowStatusIndicator — diff review pending', () => {
  it('shows 検証中（差分レビュー） while the diff review is pending', () => {
    const { getByText } = render(
      <WorkflowStatusIndicator status="in_progress" diffReviewPending />,
    );
    expect(getByText('検証中（差分レビュー）')).toBeTruthy();
  });

  it('stays 検証中 without the pending flag', () => {
    const { getByText, queryByText } = render(<WorkflowStatusIndicator status="in_progress" />);
    expect(getByText('検証中')).toBeTruthy();
    expect(queryByText('検証中（差分レビュー）')).toBeNull();
  });

  it('ignores the flag outside in_progress', () => {
    const { getByText } = render(
      <WorkflowStatusIndicator status="verify_done" diffReviewPending />,
    );
    expect(getByText(lookup('statusIndicator.verifyDone'))).toBeTruthy();
  });
});
