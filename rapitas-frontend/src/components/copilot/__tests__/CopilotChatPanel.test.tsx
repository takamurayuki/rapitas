import { render, screen, fireEvent } from '@testing-library/react';
import { CopilotChatPanel } from '../CopilotChatPanel';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));

describe('CopilotChatPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            content: 'AI response',
            model: 'haiku',
            tier: 'economy',
            cached: false,
          }),
      }),
    ) as unknown as typeof fetch;
  });

  it('renders the panel header', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText('AI コパイロット')).toBeInTheDocument();
  });

  it('renders the input field', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByPlaceholderText(/質問や指示を入力/)).toBeInTheDocument();
  });

  it('renders quick action buttons when no messages', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText('AI分析')).toBeInTheDocument();
    expect(screen.getByText('エージェント実行')).toBeInTheDocument();
  });

  it('renders proactive insight for todo status', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    expect(screen.getByText(/着手前/)).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    const sendButton = screen.getByLabelText('送信');
    expect(sendButton).toBeDisabled();
  });

  it('send button enables when input has text', () => {
    render(<CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />);
    const input = screen.getByPlaceholderText(/質問や指示を入力/);
    fireEvent.change(input, { target: { value: 'hello' } });
    const sendButton = screen.getByLabelText('送信');
    expect(sendButton).not.toBeDisabled();
  });

  it('renders message log with aria-live attribute', () => {
    const { container } = render(
      <CopilotChatPanel taskId={1} taskTitle="test" taskStatus="todo" />,
    );
    const log = container.querySelector('[role="log"]');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });
});
