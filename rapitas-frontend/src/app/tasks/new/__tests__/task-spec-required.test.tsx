/**
 * task-spec-required.test
 *
 * The new-task form asks for a development-project task's goals and a
 * completion criterion before it posts (#1555), sends 範囲外・成果物・本人確認
 * with the rest, and leaves personal tasks alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/utils/tauri', () => ({ getTaskDetailPath: (id: number) => `/tasks/${id}` }));

import { useTaskSubmit, type TaskPayloadValues } from '../hooks/useTaskSubmit';
import { TaskSpecSection } from '../components/TaskSpecSection';

const posts: Array<Record<string, unknown>> = [];

const values = (over: Partial<TaskPayloadValues> = {}): TaskPayloadValues => ({
  title: 'ログに理由を残す',
  description: '',
  priority: 'medium',
  themeId: 1,
  selectedLabelIds: [],
  estimatedHours: '',
  dueDate: '',
  workflowMode: 'comprehensive',
  isWorkflowModeOverride: false,
  goals: '理由が読める',
  constraints: '',
  acceptanceCriteria: 'dev-pull.test.cjs が通る',
  userAcceptanceChecks: '',
  outOfScope: '再起動ボタン',
  startConditions: '',
  deliverable: 'report',
  selectedTheme: { id: 1, isDevelopment: true } as TaskPayloadValues['selectedTheme'],
  globalSettings: null,
  ...over,
});

beforeEach(() => {
  posts.length = 0;
  showToast.mockReset();
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: 9 }), { status: 200 });
  });
});

async function submit(v: TaskPayloadValues) {
  const { result } = renderHook(() =>
    useTaskSubmit(
      () => v,
      () => [],
    ),
  );
  await act(async () => {
    await result.current.handleSubmit();
  });
  return result;
}

describe('a development-project task', () => {
  it('is not posted without goals, and says what is missing', async () => {
    const result = await submit(values({ goals: '' }));
    expect(posts).toEqual([]);
    expect(result.current.specIssues).toEqual({ goals: 'specErrorGoals' });
    expect(showToast).toHaveBeenCalledWith('specRequiredToast', 'error');
  });

  it('is not posted without a completion criterion of either kind', async () => {
    const result = await submit(values({ acceptanceCriteria: '' }));
    expect(posts).toEqual([]);
    expect(result.current.specIssues).toEqual({ completionCriteria: 'specErrorCompletion' });
  });

  it('is posted with 範囲外, 成果物 and 本人確認 once complete', async () => {
    await submit(values({ userAcceptanceChecks: '見て分かる' }));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      goals: ['理由が読める'],
      outOfScope: ['再起動ボタン'],
      deliverable: 'report',
      userAcceptanceChecks: ['見て分かる'],
    });
  });
});

describe('a personal task', () => {
  it('is posted without any of them', async () => {
    await submit(
      values({
        goals: '',
        acceptanceCriteria: '',
        selectedTheme: { id: 2, isDevelopment: false } as TaskPayloadValues['selectedTheme'],
      }),
    );
    expect(posts).toHaveLength(1);
  });
});

describe('the spec section', () => {
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
    canDerive: false,
    isDeriving: false,
    onDerive: noop,
  };

  it('shows what a refused submit found missing, on the fields', () => {
    render(
      <TaskSpecSection
        {...props}
        isDevelopment
        specIssues={{ goals: 'specErrorGoals', completionCriteria: 'specErrorCompletion' }}
      />,
    );
    expect(screen.getByText('specErrorGoals')).toBeTruthy();
    expect(screen.getByText('specErrorCompletion')).toBeTruthy();
    expect(screen.getByLabelText(/specGoals/).getAttribute('aria-invalid')).toBe('true');
  });

  it('offers the deliverables an agent can produce, PR selected', () => {
    render(<TaskSpecSection {...props} isDevelopment specIssues={{}} />);
    const select = screen.getByLabelText('specDeliverable') as HTMLSelectElement;
    expect(select.value).toBe('pr');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['pr', 'report', 'decision']);
  });

  it('marks nothing as required for a personal task', () => {
    render(<TaskSpecSection {...props} isDevelopment={false} specIssues={{}} />);
    expect(screen.queryByText('specRequiredHint')).toBeNull();
  });
});
