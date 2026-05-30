import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopilotChatPanel } from '../CopilotChatPanel';
import type { NextActionContext } from '../next-action-recommender';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));

// Non-dev todo with an estimate and low complexity → a single "着手する" action.
const ctxTodoManual: NextActionContext = {
  status: 'todo',
  subtaskTotal: 0,
  subtaskDone: 0,
  complexityScore: 20,
  estimatedHours: 2,
  canRunAgent: false,
};

describe('CopilotChatPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, message: 'done', data: {} }),
      }),
    ) as unknown as typeof fetch;
  });

  it('renders the panel header', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText('AI コパイロット')).toBeInTheDocument();
  });

  it('renders proactive insight for todo status', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText(/着手前/)).toBeInTheDocument();
  });

  it('renders a recommended next action from context', () => {
    render(
      <CopilotChatPanel
        taskId={1}
        taskTitle="test"
        taskStatus="todo"
        nextActionContext={ctxTodoManual}
      />,
    );
    expect(screen.getByText('次の一手')).toBeInTheDocument();
    expect(screen.getByText('着手する')).toBeInTheDocument();
  });

  it('executes the copilot action when a recommendation is clicked', async () => {
    render(
      <CopilotChatPanel
        taskId={1}
        taskTitle="test"
        taskStatus="todo"
        nextActionContext={ctxTodoManual}
      />,
    );
    fireEvent.click(screen.getByText('着手する'));
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/copilot/action'))).toBe(true);
    });
  });

  it('runs the grounded retrospective endpoint for a done task', async () => {
    const ctxDone: NextActionContext = { ...ctxTodoManual, status: 'done' };
    render(
      <CopilotChatPanel taskId={1} taskTitle="test" taskStatus="done" nextActionContext={ctxDone} />,
    );
    fireEvent.click(screen.getByText('振り返りをする'));
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/copilot/tasks/1/retrospective'))).toBe(true);
    });
  });

  it('renders message log with aria-live attribute', () => {
    const { container } = render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    const log = container.querySelector('[role="log"]');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });
});
