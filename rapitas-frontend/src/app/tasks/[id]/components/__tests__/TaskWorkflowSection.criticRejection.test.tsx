/**
 * TaskWorkflowSection — critic-rejection banner ユニットテスト
 *
 * phase-critic ゲートが research.md/plan.md を却下してアーカイブし、
 * workflowStatus をロールバックした際、ファイルが無言で消えたように
 * 見えないよう却下理由バナーを表示することを検証する回帰テスト。
 */
import { render, screen, waitFor } from '@testing-library/react';
import TaskWorkflowSection from '../TaskWorkflowSection';
import type { Task } from '@/types';

const mockT = (key: string, values?: Record<string, string>) => {
  // Minimal interpolation support for {phase} used by criticRejection.title.
  if (key === 'taskWorkflowSection.criticRejection.title' && values?.phase) {
    return `The ${values.phase} was rejected by the quality critic and is being regenerated.`;
  }
  if (key === 'taskWorkflowSection.criticRejection.phase.research') return 'research (research.md)';
  if (key === 'taskWorkflowSection.criticRejection.phase.plan') return 'plan (plan.md)';
  return key;
};
vi.mock('next-intl', () => ({
  useTranslations: () => mockT,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/components/workflow/WorkflowViewer', () => ({
  default: () => <div data-testid="workflow-viewer" />,
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Task',
    status: 'in-progress',
    workflowStatus: 'draft',
    ...overrides,
  } as Task;
}

const mockFetch = vi.fn();

describe('TaskWorkflowSection critic-rejection banner', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/settings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.includes('/transitions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, transitions: [] }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the rejection banner when the latest transition is a research_critic_failed bounce to the current status', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/transitions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              transitions: [
                {
                  cause: 'research_critic_failed',
                  toStatus: 'draft',
                  metadata: { reasons: ['要件Xへの言及が不足しています'] },
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <TaskWorkflowSection
        task={makeTask({ workflowStatus: 'draft' })}
        taskId={1}
        currentWorkflowStatus="draft"
        setCurrentWorkflowStatus={vi.fn()}
        isWorkflowLoading={false}
        workflowError={null}
        onPlanApprovalRequest={vi.fn()}
        setTask={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'The research (research.md) was rejected by the quality critic and is being regenerated.',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('要件Xへの言及が不足しています')).toBeInTheDocument();
  });

  it('does not show the banner when no critic-rejection transition exists', async () => {
    render(
      <TaskWorkflowSection
        task={makeTask({ workflowStatus: 'draft' })}
        taskId={1}
        currentWorkflowStatus="draft"
        setCurrentWorkflowStatus={vi.fn()}
        isWorkflowLoading={false}
        workflowError={null}
        onPlanApprovalRequest={vi.fn()}
        setTask={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('workflow-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByText(/was rejected by the quality critic/)).not.toBeInTheDocument();
  });

  it('does not show the banner once the status has moved past the rollback target (superseded by a new save)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/transitions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              // The critic bounce rolled back to 'draft', but the status shown
              // now is 'research_done' — a fresh research.md was saved since.
              transitions: [{ cause: 'research_critic_failed', toStatus: 'draft', metadata: {} }],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <TaskWorkflowSection
        task={makeTask({ workflowStatus: 'research_done' })}
        taskId={1}
        currentWorkflowStatus="research_done"
        setCurrentWorkflowStatus={vi.fn()}
        isWorkflowLoading={false}
        workflowError={null}
        onPlanApprovalRequest={vi.fn()}
        setTask={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('workflow-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByText(/was rejected by the quality critic/)).not.toBeInTheDocument();
  });
});
