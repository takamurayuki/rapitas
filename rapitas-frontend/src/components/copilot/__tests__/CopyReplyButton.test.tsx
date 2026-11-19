/**
 * CopyReplyButton tests
 *
 * The copy icon at the top right of ラピ's text reply in the copilot panel:
 * copies the Markdown source (not the rendered text), turns into a check for
 * a moment, never shows success when the clipboard write failed, and is not
 * offered on the user's words or on the structured analysis card.
 */
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { CopilotMessage } from '../useCopilotChat';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const SOURCE = 'まず **ログ** を見ます。\n\n- `401` を探す';

const reply: CopilotMessage = {
  id: 'a1',
  role: 'assistant',
  content: SOURCE,
  createdAt: '2026-11-19T00:00:00Z',
};

const writeText = vi.fn<(text: string) => Promise<void>>();

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('CopyReplyButton', () => {
  beforeEach(() => {
    showToast.mockReset();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    setClipboard({ writeText });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies the Markdown source, shows a check, then returns to the copy icon', async () => {
    vi.useFakeTimers();
    render(<MessageBubble msg={reply} saveNote={{ taskId: 1 }} />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith(SOURCE);
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
  });

  it('does not show success when the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<MessageBubble msg={reply} />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});

    expect(showToast).toHaveBeenCalledWith('failed', 'error');
    expect(screen.queryByRole('button', { name: 'copied' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
  });

  it('drops the check when a copy right after a success fails', async () => {
    vi.useFakeTimers();
    render(<MessageBubble msg={reply} />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();

    writeText.mockRejectedValue(new Error('denied'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'copied' }));
    await act(async () => {});

    expect(showToast).toHaveBeenCalledWith('failed', 'error');
    expect(screen.queryByRole('button', { name: 'copied' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();

    // The stale reset timer from the first copy must not fire into anything.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
  });

  it('does not show success when the clipboard API is missing', async () => {
    setClipboard(undefined);
    render(<MessageBubble msg={reply} />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});

    expect(showToast).toHaveBeenCalledWith('failed', 'error');
    expect(screen.queryByRole('button', { name: 'copied' })).not.toBeInTheDocument();
  });

  it('is not offered on the user words, the analysis card or an empty reply', () => {
    const { container, rerender } = render(
      <MessageBubble msg={{ ...reply, id: 'u1', role: 'user' }} />,
    );
    expect(within(container).queryByRole('button', { name: 'copy' })).not.toBeInTheDocument();

    rerender(
      <MessageBubble
        msg={{
          ...reply,
          id: 'a2',
          actionData: {
            type: 'analyze',
            data: {
              summary: 's',
              complexity: 'low',
              estimatedTotalHours: 1,
              suggestedSubtasks: [],
              tips: [],
            },
          },
        }}
      />,
    );
    expect(within(container).queryByRole('button', { name: 'copy' })).not.toBeInTheDocument();

    rerender(<MessageBubble msg={{ ...reply, id: 'a3', content: '  ' }} />);
    expect(within(container).queryByRole('button', { name: 'copy' })).not.toBeInTheDocument();
  });
});
