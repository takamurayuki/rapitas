import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskCardAutoRunToggle from './TaskCardAutoRunToggle';
import type { Task } from '@/types';

const showToast = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    autoRunExcluded: false,
    ...overrides,
  }) as Task;

describe('TaskCardAutoRunToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('autoRunExcluded=false のタスクは「除外」ボタンとして表示される', () => {
    render(<TaskCardAutoRunToggle task={createMockTask({ autoRunExcluded: false })} />);
    const button = screen.getByRole('button', { name: 'taskCard.autoRunExcludeTitle' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('autoRunExcluded=true のタスクは「対象に戻す」ボタンとして表示される', () => {
    render(<TaskCardAutoRunToggle task={createMockTask({ autoRunExcluded: true })} />);
    const button = screen.getByRole('button', { name: 'taskCard.autoRunIncludeTitle' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('クリックで autoRunExcluded を反転する PATCH を送り、成功時に onTaskUpdated を呼ぶ', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const onTaskUpdated = vi.fn();
    render(
      <TaskCardAutoRunToggle
        task={createMockTask({ autoRunExcluded: false })}
        onTaskUpdated={onTaskUpdated}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/tasks/1',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoRunExcluded: true }),
      }),
    );
  });

  it('クリックイベントは親要素に伝播しない（カード全体のクリックを誘発しない）', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <TaskCardAutoRunToggle task={createMockTask()} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('レスポンスがokでない場合はエラートーストを表示し、onTaskUpdatedを呼ばない', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const onTaskUpdated = vi.fn();
    render(<TaskCardAutoRunToggle task={createMockTask()} onTaskUpdated={onTaskUpdated} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('taskCard.autoRunExcludedToggleFailed', 'error'),
    );
    expect(onTaskUpdated).not.toHaveBeenCalled();
  });

  it('fetchが例外を投げた場合もエラートーストを表示する', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    render(<TaskCardAutoRunToggle task={createMockTask()} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('taskCard.autoRunExcludedToggleFailed', 'error'),
    );
  });
});
