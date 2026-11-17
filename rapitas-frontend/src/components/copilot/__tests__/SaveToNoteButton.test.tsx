/**
 * SaveToNoteButton tests
 *
 * The "ノートに保存" action under ラピ's reply in the copilot panel: shown on
 * text replies only, turns into "保存済み" after a save and does not send
 * again, and never reports success when the save failed.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { CopilotMessage } from '../useCopilotChat';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const reply: CopilotMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'まず **ログ** を見ます。',
  createdAt: '2026-11-17T00:00:00Z',
};

function renderReply(msg: CopilotMessage = reply) {
  return render(
    <MessageBubble msg={msg} saveNote={{ question: 'どこから調べる？', taskId: 42 }} />,
  );
}

describe('SaveToNoteButton', () => {
  beforeEach(() => {
    showToast.mockReset();
    push.mockReset();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
    ) as unknown as typeof fetch;
  });

  it('saves once, shows the saved state and does not send again', async () => {
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled());
    const methods = vi
      .mocked(global.fetch)
      .mock.calls.map(([, init]) => (init as RequestInit).method);
    expect(methods).toEqual(['PUT', 'POST']);
    expect(showToast).toHaveBeenCalledWith('savedToast', 'success', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'saved' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // The toast's "開く" goes to the notes page.
    const action = showToast.mock.calls[0][2].action as { onClick: () => void };
    action.onClick();
    expect(push).toHaveBeenCalledWith('/notes');
  });

  it('says the link failed when only the link failed', async () => {
    global.fetch = vi.fn((url: string) =>
      Promise.resolve({
        ok: !url.endsWith('/links'),
        status: 500,
        json: () => Promise.resolve({}),
      }),
    ) as unknown as typeof fetch;
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('savedLinkFailed', 'warning', expect.anything());
  });

  it('stays saved when only the local copy failed, so a retry cannot make a second note', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    try {
      renderReply();
      fireEvent.click(screen.getByRole('button', { name: 'save' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled());
      expect(showToast).toHaveBeenCalledWith('savedToast', 'success', expect.anything());
      expect(showToast).not.toHaveBeenCalledWith('failed', 'error');
      fireEvent.click(screen.getByRole('button', { name: 'saved' }));
      await new Promise((r) => setTimeout(r, 0));
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      setItem.mockRestore();
    }
  });

  it('does not show success when the save failed, and lets the user retry', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    ) as unknown as typeof fetch;
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('failed', 'error'));
    expect(showToast).not.toHaveBeenCalledWith('savedToast', expect.anything(), expect.anything());
    expect(screen.queryByRole('button', { name: 'saved' })).toBeNull();
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
  });

  it('is not offered on the user line or the analysis card', () => {
    const { unmount } = renderReply({ ...reply, role: 'user' });
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
    unmount();
    renderReply({
      ...reply,
      actionData: {
        type: 'analyze',
        data: { summary: 's', complexity: 'low', estimatedTotalHours: 1, suggestedSubtasks: [] },
      },
    });
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
  });
});
