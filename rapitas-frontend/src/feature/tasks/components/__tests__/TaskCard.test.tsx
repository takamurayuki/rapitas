import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskCard from '../TaskCard';
import type { Task, Status, Priority } from '@/types';

// Mock dependencies
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/stores/executionStateStore', () => ({
  useExecutionStateStore: (
    selector: (state: {
      getExecutingTaskStatus: (id: number) => null;
    }) => unknown,
  ) => selector({ getExecutingTaskStatus: () => null }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  prefetch: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('@/utils/labels', () => ({
  getLabelsArray: (labels: unknown) => {
    if (!labels) return [];
    if (typeof labels === 'string') {
      try {
        const parsed = JSON.parse(labels);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (Array.isArray(labels)) return labels;
    return [];
  },
  hasLabels: (labels: unknown) => {
    if (!labels) return false;
    if (Array.isArray(labels)) return labels.length > 0;
    if (typeof labels === 'string') {
      try {
        const parsed = JSON.parse(labels);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  },
}));

// Mock PriorityIcon component
vi.mock('@/feature/tasks/components/PriorityIcon', () => ({
  default: ({
    priority,
  }: {
    priority: string | null | undefined;
    size?: string;
  }) =>
    priority ? <span data-testid="priority-icon">{priority}</span> : null,
}));

// Mock TaskStatusChange component
vi.mock('@/feature/tasks/components/TaskStatusChange', () => ({
  default: ({
    status,
    currentStatus,
    onClick,
  }: {
    status: string;
    currentStatus: string;
    config: unknown;
    renderIcon: unknown;
    onClick: (s: string) => void;
    size?: string;
  }) => (
    <button
      data-testid={`status-btn-${status}`}
      data-current={currentStatus === status ? 'true' : 'false'}
      onClick={(e) => {
        e.stopPropagation();
        onClick(status);
      }}
    >
      {status}
    </button>
  ),
}));

// Mock SubtaskStatusButtons
vi.mock('@/feature/tasks/components/SubtaskStatusButtons', () => ({
  default: () => <div data-testid="subtask-status-buttons" />,
}));

// Mock StatusConfig
vi.mock('@/feature/tasks/config/StatusConfig', () => ({
  statusConfig: {
    todo: {
      color: 'text-zinc-700',
      bgColor: 'bg-zinc-100',
      borderColor: 'border-l-zinc-400',
      label: '未着手',
    },
    'in-progress': {
      color: 'text-blue-700',
      bgColor: 'bg-blue-50',
      borderColor: 'border-l-blue-500',
      label: '進行中',
    },
    done: {
      color: 'text-green-700',
      bgColor: 'bg-green-50',
      borderColor: 'border-l-green-500',
      label: '完了',
    },
  },
  renderStatusIcon: (status: string) => (
    <span data-testid={`status-icon-${status}`} />
  ),
}));

// Mock TaskCompletionAnimation
vi.mock('../TaskCompletionAnimation', () => ({
  CardLightSweep: ({ active }: { active: boolean }) =>
    active ? <div data-testid="card-light-sweep" /> : null,
  useProgressColors: () => ({
    primary: '#000',
    primaryLight: '#111',
    primaryDark: '#222',
  }),
}));

// Mock ModernCheckbox
vi.mock('@/components/ui/ModernCheckbox', () => ({
  ModernCheckbox: ({
    checked,
    onChange,
    onClick,
  }: {
    checked: boolean;
    onChange: () => void;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        if (onClick) onClick(e);
        onChange();
      }}
    />
  ),
}));

// Mock lucide-react icons used in TaskCard
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Icon = ({ className }: { className?: string }) => (
      <div data-testid={name} className={className} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    ExternalLink: createIcon('external-link'),
    Tag: createIcon('tag'),
    Copy: createIcon('copy'),
    Trash2: createIcon('trash2'),
    Edit: createIcon('edit'),
  };
});

vi.mock('@/components/category/IconData', () => ({
  getIconComponent: () => () => <div data-testid="category-icon" />,
}));

// Sample task data
const mockTask: Task = {
  id: 1,
  title: 'Test Task',
  description: 'Test description',
  status: 'todo' as Status,
  priority: 'high' as Priority,
  themeId: 1,
  labels: ['urgent', 'frontend'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockProps = {
  task: mockTask,
  isSelected: false,
  isSelectionMode: false,
  onTaskClick: vi.fn(),
  onStatusChange: vi.fn(),
  onToggleSelect: vi.fn(),
  onTaskUpdated: vi.fn(),
  onOpenInPage: vi.fn(),
  sweepingTaskId: null,
};

describe('TaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本レンダリング', () => {
    it('タスクタイトルが表示される', () => {
      render(<TaskCard {...mockProps} />);
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    it('作成日が表示される', () => {
      render(<TaskCard {...mockProps} />);
      // Date formatted as ja-JP month/day
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('ラベルがある場合にラベル数が表示される', () => {
      render(<TaskCard {...mockProps} />);
      // hasLabels returns true for ['urgent', 'frontend'], shows count
      expect(screen.getByTestId('tag')).toBeInTheDocument();
    });
  });

  describe('ステータス表示', () => {
    it('todoステータスのアイコンが適切に表示される', () => {
      render(<TaskCard {...mockProps} />);
      expect(screen.getByTestId('status-icon-todo')).toBeInTheDocument();
    });

    it('ステータス変更ボタンが表示される', () => {
      render(<TaskCard {...mockProps} />);
      expect(screen.getByTestId('status-btn-todo')).toBeInTheDocument();
      expect(screen.getByTestId('status-btn-in-progress')).toBeInTheDocument();
      expect(screen.getByTestId('status-btn-done')).toBeInTheDocument();
    });

    it('異なるステータスでも適切に表示される', () => {
      const taskInProgress = {
        ...mockTask,
        status: 'in-progress' as Status,
      };
      render(<TaskCard {...mockProps} task={taskInProgress} />);
      expect(
        screen.getByTestId('status-icon-in-progress'),
      ).toBeInTheDocument();
    });
  });

  describe('プライオリティ表示', () => {
    it('プライオリティアイコンが表示される', () => {
      render(<TaskCard {...mockProps} />);
      const priorityIcon = screen.getByTestId('priority-icon');
      expect(priorityIcon).toBeInTheDocument();
      expect(priorityIcon).toHaveTextContent('high');
    });
  });

  describe('選択モード', () => {
    it('選択モードでチェックボックスが表示される', () => {
      render(<TaskCard {...mockProps} isSelectionMode={true} />);
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeInTheDocument();
    });

    it('選択状態が適切に反映される', () => {
      render(
        <TaskCard {...mockProps} isSelectionMode={true} isSelected={true} />,
      );
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toHaveAttribute('aria-checked', 'true');
    });

    it('チェックボックスクリックで選択状態が切り替わる', () => {
      render(<TaskCard {...mockProps} isSelectionMode={true} />);
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      expect(mockProps.onToggleSelect).toHaveBeenCalledWith(1);
    });
  });

  describe('イベントハンドリング', () => {
    it('タスククリックで適切なコールバックが呼ばれる', () => {
      render(<TaskCard {...mockProps} />);
      const taskTitle = screen.getByText('Test Task');
      // Click the clickable area (parent div with cursor-pointer)
      fireEvent.click(taskTitle);
      expect(mockProps.onTaskClick).toHaveBeenCalledWith(1);
    });

    it('ステータスボタンクリックで適切なコールバックが呼ばれる', () => {
      render(<TaskCard {...mockProps} />);
      const inProgressBtn = screen.getByTestId('status-btn-in-progress');
      fireEvent.click(inProgressBtn);
      expect(mockProps.onStatusChange).toHaveBeenCalledWith(
        1,
        'in-progress',
        expect.anything(),
      );
    });
  });

  describe('コンテキストメニュー', () => {
    it('右クリックでコンテキストメニューが表示される', async () => {
      render(<TaskCard {...mockProps} />);
      const taskTitle = screen.getByText('Test Task');
      const clickableArea = taskTitle.closest('.cursor-pointer')!;

      fireEvent.contextMenu(clickableArea);

      await waitFor(() => {
        // Context menu shows edit, copy (duplicate), and delete buttons
        expect(screen.getByTestId('edit')).toBeInTheDocument();
        expect(screen.getByTestId('copy')).toBeInTheDocument();
        expect(screen.getByTestId('trash2')).toBeInTheDocument();
      });
    });
  });

  describe('ページで開くボタン', () => {
    it('onOpenInPageが渡されている場合にボタンが表示される', () => {
      render(<TaskCard {...mockProps} />);
      expect(screen.getByTestId('external-link')).toBeInTheDocument();
    });

    it('onOpenInPageが未定義の場合にボタンが非表示', () => {
      render(<TaskCard {...mockProps} onOpenInPage={undefined} />);
      expect(screen.queryByTestId('external-link')).not.toBeInTheDocument();
    });
  });

  describe('アニメーション', () => {
    it('スイープアニメーションコンポーネントがレンダリングされる', () => {
      render(<TaskCard {...mockProps} sweepingTaskId={1} />);
      const cardContainer = screen
        .getByText('Test Task')
        .closest('[data-task-card]');
      expect(cardContainer).toBeInTheDocument();
      expect(screen.getByTestId('card-light-sweep')).toBeInTheDocument();
    });

    it('非スイープ時もカードは正常に表示される', () => {
      render(<TaskCard {...mockProps} sweepingTaskId={2} />);
      const cardContainer = screen
        .getByText('Test Task')
        .closest('[data-task-card]');
      expect(cardContainer).toBeInTheDocument();
    });
  });

  describe('エッジケース', () => {
    it('ラベルがない場合でも適切に表示される', () => {
      const taskWithoutLabels = { ...mockTask, labels: undefined };
      render(<TaskCard {...mockProps} task={taskWithoutLabels} />);
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    it('説明が空の場合でも適切に表示される', () => {
      const taskWithoutDescription = { ...mockTask, description: '' };
      render(<TaskCard {...mockProps} task={taskWithoutDescription} />);
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    it('テーマがない場合でも適切に表示される', () => {
      const taskWithoutTheme = { ...mockTask, theme: null };
      render(<TaskCard {...mockProps} task={taskWithoutTheme} />);
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });
  });

  describe('アクセシビリティ', () => {
    it('タスクカード要素が適切にレンダリングされる', () => {
      render(<TaskCard {...mockProps} />);
      const taskElement = screen
        .getByText('Test Task')
        .closest('[data-task-card]');
      expect(taskElement).toBeInTheDocument();
    });

    it('クリック可能な要素として機能する', () => {
      render(<TaskCard {...mockProps} />);
      const clickableArea = screen
        .getByText('Test Task')
        .closest('.cursor-pointer');
      expect(clickableArea).toBeInTheDocument();
      expect(clickableArea).toHaveClass('cursor-pointer');
    });
  });
});
