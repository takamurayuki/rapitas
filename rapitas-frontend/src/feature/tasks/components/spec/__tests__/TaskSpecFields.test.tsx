/**
 * TaskSpecFields.test
 *
 * "受入基準" on the new-task form and "完了条件" in the detail named the same
 * thing two ways (#1557). Both forms now show one 完了条件 heading with the two
 * kinds under it — what the agent checks and what the person checks — and a
 * missing condition is reported once, for the group, since either will do.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { TaskSpecFields } from '../TaskSpecFields';

const noop = () => {};
const props = {
  goals: '',
  setGoals: noop,
  outOfScope: '',
  setOutOfScope: noop,
  startConditions: '',
  setStartConditions: noop,
  constraints: '',
  setConstraints: noop,
  acceptanceCriteria: '',
  setAcceptanceCriteria: noop,
  userAcceptanceChecks: '',
  setUserAcceptanceChecks: noop,
  deliverable: 'pr' as const,
  setDeliverable: noop,
};

describe('the completion conditions', () => {
  it('sit under one heading, the agent’s and the person’s', () => {
    render(<TaskSpecFields {...props} isDevelopment={false} specIssues={{}} />);
    const group = document.querySelector('[data-spec-field="completion"]') as HTMLElement;
    expect(group.querySelector('legend')?.textContent).toContain('specCompletion');
    expect(group.querySelector('[data-spec-field="acceptance"] label')?.textContent).toBe(
      'specAcceptance',
    );
    expect(group.querySelector('[data-spec-field="userChecks"] label')?.textContent).toBe(
      'specUserChecks',
    );
  });

  it('report a missing condition once, on both fields', () => {
    render(
      <TaskSpecFields
        {...props}
        isDevelopment
        specIssues={{ completionCriteria: 'specErrorCompletion' }}
      />,
    );
    expect(screen.getAllByText('specErrorCompletion')).toHaveLength(1);
    expect(screen.getByLabelText('specAcceptance').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('specUserChecks').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('the layout', () => {
  it('asks each field with its own example, not one shared placeholder', () => {
    render(<TaskSpecFields {...props} isDevelopment={false} specIssues={{}} />);
    expect(screen.getByLabelText(/specGoals/).getAttribute('placeholder')).toBe(
      'specGoalsPlaceholder',
    );
    expect(screen.getByLabelText('specAcceptance').getAttribute('placeholder')).toBe(
      'specAcceptancePlaceholder',
    );
  });

  it('offers the deliverable as visible choices', () => {
    const setDeliverable = vi.fn();
    render(
      <TaskSpecFields
        {...props}
        setDeliverable={setDeliverable}
        isDevelopment={false}
        specIssues={{}}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'specDeliverable' });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: /deliverable\.report/ }));
    expect(setDeliverable).toHaveBeenCalledWith('report');
  });

  it('folds the optional scope fields while they are empty', () => {
    render(<TaskSpecFields {...props} isDevelopment={false} specIssues={{}} />);
    expect(screen.queryByLabelText('specOutOfScope')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /specScope/ }));
    expect(screen.getByLabelText('specOutOfScope')).toBeTruthy();
  });

  it('shows them open when one is filled in', () => {
    render(
      <TaskSpecFields
        {...props}
        constraints="既存APIは変えない"
        isDevelopment={false}
        specIssues={{}}
      />,
    );
    expect(screen.getByLabelText('specConstraints')).toBeTruthy();
  });
});
