import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopilotChatPanel } from '../CopilotChatPanel';
import type { NextActionContext } from '../next-action-recommender';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

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
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('renders proactive insight for todo status', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText(/todoInsight/)).toBeInTheDocument();
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
    expect(screen.getByText('heading')).toBeInTheDocument();
    // NOTE: the mocked t() echoes the key verbatim (see the next-intl mock above);
    // labels/reasons are now resolved via labelKey/reasonKey, not raw text.
    expect(screen.getByText('actions.start.label')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('actions.start.label'));
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/copilot/action'))).toBe(true);
    });
  });

  it('runs the grounded retrospective endpoint for a done task', async () => {
    const ctxDone: NextActionContext = { ...ctxTodoManual, status: 'done' };
    render(
      <CopilotChatPanel
        taskId={1}
        taskTitle="test"
        taskStatus="done"
        nextActionContext={ctxDone}
      />,
    );
    fireEvent.click(screen.getByText('actions.reflect.label'));
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/copilot/tasks/1/retrospective'))).toBe(true);
    });
  });

  it('renders message log with aria-live attribute', () => {
    const { container } = render(
      <CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />,
    );
    const log = container.querySelector('[role="log"]');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  // nav62: the consult chat feels like ラピ's thread — the sentence she took
  // in gets a 👌, a failed one does not, and the wait is three dots.
  describe('chat feel', () => {
    const ctxBlocked: NextActionContext = { ...ctxTodoManual, status: 'blocked' };
    let finish: (ok: boolean) => void;

    beforeEach(() => {
      global.fetch = vi.fn((url: string) => {
        if (!String(url).includes('/copilot/chat') || String(url).includes('/history')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return new Promise((resolve) => {
          finish = (ok) =>
            resolve({
              ok,
              status: ok ? 200 : 500,
              json: () =>
                Promise.resolve(ok ? { success: true, content: '**理由** はこれです' } : {}),
            });
        });
      }) as unknown as typeof fetch;
    });

    const send = () => {
      render(
        <CopilotChatPanel
          taskId={1}
          taskTitle="test"
          taskStatus="blocked"
          nextActionContext={ctxBlocked}
        />,
      );
      fireEvent.click(screen.getByText('actions.blocked.label'));
    };
    const stamps = () => document.querySelectorAll('[data-chat-received]');

    it('stamps the sentence and shows the dots while the answer is on its way', async () => {
      send();
      await waitFor(() => expect(stamps()).toHaveLength(1));
      const typing = document.querySelector('[data-chat-typing]');
      expect(typing?.querySelectorAll('[data-chat-typing-dot]')).toHaveLength(3);
      expect(typing?.textContent).toBe('');

      finish(true);
      await waitFor(() => expect(document.querySelector('[data-chat-typing]')).toBeNull());
      expect(stamps()).toHaveLength(1);
      // The reply is Markdown at chat density, not the raw marks.
      expect(screen.getByText('理由').tagName).toBe('STRONG');
      expect(document.querySelector('[data-density="chat"]')).not.toBeNull();
    });

    it('takes the stamp off a sentence whose send failed', async () => {
      send();
      await waitFor(() => expect(stamps()).toHaveLength(1));
      finish(false);
      await waitFor(() => expect(stamps()).toHaveLength(0));
      expect(document.querySelector('[data-chat-typing]')).toBeNull();
    });
  });
});
