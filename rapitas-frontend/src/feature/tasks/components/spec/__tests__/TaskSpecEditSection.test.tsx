/**
 * TaskSpecEditSection.test
 *
 * The task detail is where a development-project task stopped for a missing
 * goal or criterion gets them (#1555). The editor holds it to the same rule
 * as the new-task form and sends back the criteria revision it was loaded
 * with, which the PATCH requires for goals, constraints and criteria.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/api-client', () => ({ clearApiCache: vi.fn() }));
vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

import { Accordion } from '@/components/ui/accordion/Accordion';
import TaskSpecEditSection from '../TaskSpecEditSection';
import type { Task } from '@/types';

const patches: Array<Record<string, unknown>> = [];
let status = 200;

const task = {
  id: 1498,
  title: 'ログに理由を残す',
  goals: '["理由が読める"]',
  constraints: null,
  acceptanceCriteria: '["テストが通る"]',
  userAcceptanceChecks: null,
  outOfScope: '["再起動ボタン"]',
  deliverable: 'report',
  criteriaRevision: 'rev-1',
} as unknown as Task;

beforeEach(() => {
  patches.length = 0;
  status = 200;
  showToast.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    // The prerequisites list loads on its own (#1559); only PATCHes are recorded.
    if (String(url).endsWith('/dependencies')) {
      return new Response(JSON.stringify({ prerequisites: [] }), { status: 200 });
    }
    patches.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify(status === 200 ? {} : { error: '完了条件が変わっています' }),
      {
        status,
      },
    );
  });
});

function renderSection(over: Partial<Task> = {}, onTaskUpdated = vi.fn()) {
  render(
    <Accordion defaultExpanded={['spec']}>
      <TaskSpecEditSection
        task={{ ...task, ...over }}
        isDevelopment
        onTaskUpdated={onTaskUpdated}
      />
    </Accordion>,
  );
  return onTaskUpdated;
}

describe('the spec at a glance', () => {
  it('lists goals and what is out of scope, and names the deliverable', () => {
    renderSection();
    expect(screen.getByText('理由が読める')).toBeTruthy();
    expect(screen.getByText('再起動ボタン')).toBeTruthy();
    expect(screen.getByText('deliverable.report')).toBeTruthy();
  });

  it('says the goals are missing on a development task without them', () => {
    renderSection({ goals: null });
    expect(screen.getByRole('alert').textContent).toBe('specErrorGoals');
  });
});

describe('editing the spec', () => {
  it('does not save a development task without goals', async () => {
    renderSection();
    fireEvent.click(screen.getByText('specEdit'));
    fireEvent.change(screen.getByLabelText(/specGoals/), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByText('specSave'));
    });
    expect(patches).toEqual([]);
    expect(screen.getByText('specErrorGoals')).toBeTruthy();
  });

  it('saves every field with the revision it was loaded with, then reloads', async () => {
    const reload = renderSection();
    fireEvent.click(screen.getByText('specEdit'));
    fireEvent.change(screen.getByLabelText('specUserChecks'), { target: { value: '見て分かる' } });
    await act(async () => {
      fireEvent.click(screen.getByText('specSave'));
    });
    expect(patches[0]).toEqual({
      goals: ['理由が読める'],
      constraints: [],
      acceptanceCriteria: ['テストが通る'],
      userAcceptanceChecks: ['見て分かる'],
      outOfScope: ['再起動ボタン'],
      startConditions: [],
      deliverable: 'report',
      expectedCriteriaRevision: 'rev-1',
    });
    expect(reload).toHaveBeenCalled();
  });

  it('shows why the server refused, and stays in the editor', async () => {
    status = 409;
    renderSection();
    fireEvent.click(screen.getByText('specEdit'));
    await act(async () => {
      fireEvent.click(screen.getByText('specSave'));
    });
    expect(showToast).toHaveBeenCalledWith('完了条件が変わっています', 'error');
    expect(screen.getByText('specSave')).toBeTruthy();
  });
});
